//! Tauri application composition and validated IPC command surface.
mod database;
mod error;
mod models;
mod steam;

use crate::database::{validate_steam_id, Database};
use crate::error::{AppError, AppResult};
use crate::models::*;
use chrono::Utc;
use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{Manager, State};
use uuid::Uuid;

pub struct AppState {
    db: Database,
    data_dir: PathBuf,
    switch_lock: AtomicBool,
    launch_lock: Mutex<()>,
}
fn steam_path(state: &AppState) -> AppResult<PathBuf> {
    let value = state
        .db
        .setting("steam_path")?
        .ok_or_else(|| AppError::new("STEAM_NOT_CONFIGURED", "尚未配置 Steam 安装目录"))?;
    serde_json::from_str(&value).map_err(|_| AppError::new("SETTING_INVALID", "Steam 路径设置无效"))
}

#[tauri::command]
fn discover_steam() -> AppResult<Option<String>> {
    Ok(steam::discover()?.map(|p| p.to_string_lossy().into_owned()))
}
#[tauri::command]
fn set_steam_path(state: State<AppState>, path: String) -> AppResult<()> {
    let path = PathBuf::from(path.trim());
    steam::validate_dir(&path)?;
    state.db.set_setting(
        "steam_path",
        &serde_json::to_string(&path)
            .map_err(|_| AppError::new("SETTING_INVALID", "无法保存 Steam 路径"))?,
    )
}
#[tauri::command]
fn scan_accounts(state: State<AppState>) -> AppResult<usize> {
    let accounts = steam::read_accounts(&steam_path(&state)?)?;
    state.db.sync_accounts(&accounts)
}
#[tauri::command]
fn list_accounts(state: State<AppState>) -> AppResult<Vec<Account>> {
    state.db.list_accounts()
}
#[tauri::command]
fn save_profile(state: State<AppState>, input: ProfileInput) -> AppResult<()> {
    state.db.save_profile(&input)
}
#[tauri::command]
fn delete_profile(state: State<AppState>, id: String) -> AppResult<()> {
    if id.trim().is_empty() {
        return Err(AppError::new("INVALID_ID", "账号 ID 不能为空"));
    }
    state.db.delete_profile(&id)
}
#[tauri::command]
fn list_platform_links(
    state: State<AppState>,
    steam_account_id: String,
) -> AppResult<Vec<PlatformLink>> {
    state.db.list_links(&steam_account_id)
}
#[tauri::command]
fn save_platform_link(state: State<AppState>, input: PlatformLinkInput) -> AppResult<()> {
    state.db.save_link(&input)
}
#[tauri::command]
fn delete_platform_link(state: State<AppState>, id: String) -> AppResult<()> {
    state.db.delete_link(&id)
}
#[tauri::command]
fn current_status(state: State<AppState>) -> CurrentStatus {
    let path = steam_path(&state).ok();
    steam::status(path.as_deref())
}

#[tauri::command]
fn switch_account(state: State<AppState>, steam_id64: String) -> AppResult<SwitchResult> {
    validate_steam_id(&steam_id64)?;
    if state
        .switch_lock
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(AppError::new(
            "SWITCH_IN_PROGRESS",
            "已有账号切换任务正在进行",
        ));
    }
    let started = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let result = (|| -> AppResult<Account> {
        let account = state
            .db
            .list_accounts()?
            .into_iter()
            .find(|a| a.steam_id64 == steam_id64)
            .ok_or_else(|| AppError::new("ACCOUNT_NOT_FOUND", "找不到目标账号"))?;
        if !account.local_available {
            return Err(AppError::new(
                "ACCOUNT_NOT_LOCAL",
                "目标账号当前不在本机 Steam 登录列表中",
            ));
        }
        let dir = steam_path(&state)?;
        let backup = state.data_dir.join("backups");
        fs::create_dir_all(&backup)?;
        let timeout = state
            .db
            .setting("shutdown_timeout")?
            .and_then(|value| serde_json::from_str::<u64>(&value).ok())
            .unwrap_or(15)
            .clamp(5, 120);
        steam::switch(&dir, &backup, &steam_id64, timeout)?;
        state.db.mark_switched(&steam_id64)?;
        Ok(account)
    })();
    state.switch_lock.store(false, Ordering::Release);
    let finished = Utc::now().to_rfc3339();
    let (outcome, message, account_id, masked) = match &result {
        Ok(a) => (
            "success",
            "Steam 已按目标账号启动".to_string(),
            Some(a.id.clone()),
            a.account_name.as_deref().map(mask_name),
        ),
        Err(e) => ("failed", e.message.clone(), None, None),
    };
    state.db.0.lock().execute("INSERT INTO switch_logs(id,steam_account_id,account_name,started_at,finished_at,result,error_message) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,account_id,masked,started,finished,outcome,if outcome=="failed"{Some(message.clone())}else{None}])?;
    result.map(|_| SwitchResult {
        success: true,
        stage: "completed".into(),
        message,
    })
}

fn mask_name(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 4 {
        "***".into()
    } else {
        format!(
            "{}{}***{}{}",
            chars[0],
            chars[1],
            chars[chars.len() - 2],
            chars[chars.len() - 1]
        )
    }
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> AppResult<BTreeMap<String, Value>> {
    let conn = state.db.0.lock();
    let mut stmt = conn.prepare("SELECT key,value_json FROM app_settings ORDER BY key")?;
    let mut map = BTreeMap::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = row?;
        map.insert(k, serde_json::from_str(&v).unwrap_or(Value::String(v)));
    }
    Ok(map)
}
#[tauri::command]
fn set_setting(state: State<AppState>, key: String, value: Value) -> AppResult<()> {
    let allowed = [
        "scan_on_startup",
        "shutdown_timeout",
        "startup_timeout",
        "backup_directory",
        "theme",
        "steam_path",
    ];
    if !allowed.contains(&key.as_str()) {
        return Err(AppError::new("SETTING_NOT_ALLOWED", "不允许修改该设置"));
    }
    state.db.set_setting(
        &key,
        &serde_json::to_string(&value)
            .map_err(|_| AppError::new("SETTING_INVALID", "设置值无效"))?,
    )
}

#[tauri::command]
fn list_switch_logs(state: State<AppState>) -> AppResult<Vec<SwitchLog>> {
    let conn = state.db.0.lock();
    let mut stmt=conn.prepare("SELECT id,steam_account_id,account_name,started_at,finished_at,result,error_message FROM switch_logs ORDER BY started_at DESC LIMIT 500")?;
    let logs = stmt
        .query_map([], |r| {
            Ok(SwitchLog {
                id: r.get(0)?,
                steam_account_id: r.get(1)?,
                account_name: r.get(2)?,
                started_at: r.get(3)?,
                finished_at: r.get(4)?,
                result: r.get(5)?,
                error_message: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(logs)
}
#[tauri::command]
fn clear_switch_logs(state: State<AppState>) -> AppResult<()> {
    state.db.0.lock().execute("DELETE FROM switch_logs", [])?;
    Ok(())
}

#[tauri::command]
fn save_platform_app(state: State<AppState>, app: PlatformApp) -> AppResult<()> {
    if !["perfectworld", "5e", "faceit", "other"].contains(&app.platform_code.as_str()) {
        return Err(AppError::new("INVALID_PLATFORM", "平台类型无效"));
    }
    let executable = Path::new(&app.executable_path);
    if !executable.is_file()
        || executable
            .extension()
            .and_then(|v| v.to_str())
            .map(|v| !v.eq_ignore_ascii_case("exe"))
            .unwrap_or(true)
    {
        return Err(AppError::new(
            "INVALID_EXECUTABLE",
            "请选择有效的 Windows .exe 文件",
        ));
    }
    let args = serde_json::to_string(&app.arguments)
        .map_err(|_| AppError::new("INVALID_ARGUMENTS", "启动参数无效"))?;
    state.db.0.lock().execute("INSERT INTO platform_apps(platform_code,name,executable_path,arguments_json,working_directory,prelaunch_check,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(platform_code) DO UPDATE SET name=excluded.name,executable_path=excluded.executable_path,arguments_json=excluded.arguments_json,working_directory=excluded.working_directory,prelaunch_check=excluded.prelaunch_check,updated_at=excluded.updated_at",params![app.platform_code,app.name,app.executable_path,args,app.working_directory,app.prelaunch_check as i64,Utc::now().to_rfc3339()])?;
    Ok(())
}
#[tauri::command]
fn launch_platform(
    state: State<AppState>,
    platform_code: String,
    target_steam_id64: String,
) -> AppResult<()> {
    let _guard = state
        .launch_lock
        .try_lock()
        .ok_or_else(|| AppError::new("LAUNCH_IN_PROGRESS", "已有程序启动任务正在进行"))?;
    validate_steam_id(&target_steam_id64)?;
    let account = state
        .db
        .list_accounts()?
        .into_iter()
        .find(|a| a.steam_id64 == target_steam_id64)
        .ok_or_else(|| AppError::new("ACCOUNT_NOT_FOUND", "找不到目标 Steam 账号"))?;
    let conn = state.db.0.lock();
    let app:PlatformApp=conn.query_row("SELECT platform_code,name,executable_path,arguments_json,working_directory,prelaunch_check FROM platform_apps WHERE platform_code=?1",[platform_code],|r|Ok(PlatformApp{platform_code:r.get(0)?,name:r.get(1)?,executable_path:r.get(2)?,arguments:serde_json::from_str(&r.get::<_,String>(3)?).unwrap_or_default(),working_directory:r.get(4)?,prelaunch_check:r.get::<_,i64>(5)?!=0})).optional()?.ok_or_else(||AppError::new("PLATFORM_NOT_CONFIGURED","尚未配置平台程序"))?;
    drop(conn);
    if app.prelaunch_check
        && steam::status(Some(&steam_path(&state)?))
            .steam_id64
            .as_deref()
            != Some(&account.steam_id64)
    {
        return Err(AppError::new(
            "STEAM_ACCOUNT_MISMATCH",
            "当前 Steam 账号与目标账号不一致",
        ));
    }
    let path = PathBuf::from(&app.executable_path);
    if !path.is_file() {
        return Err(AppError::new("EXECUTABLE_NOT_FOUND", "平台程序文件不存在"));
    }
    let mut cmd = Command::new(path);
    cmd.args(&app.arguments);
    if let Some(dir) = app.working_directory.filter(|v| !v.trim().is_empty()) {
        if !Path::new(&dir).is_dir() {
            return Err(AppError::new("WORKING_DIRECTORY_INVALID", "工作目录不存在"));
        }
        cmd.current_dir(dir);
    }
    cmd.spawn()
        .map_err(|_| AppError::new("PLATFORM_LAUNCH_FAILED", "无法启动平台程序"))?;
    Ok(())
}

fn dangerous(value: &Value, path: &str, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                let lower = k.to_ascii_lowercase();
                if [
                    "password",
                    "cookie",
                    "token",
                    "secret",
                    "shared_secret",
                    "identity_secret",
                    "steam_guard",
                ]
                .iter()
                .any(|d| lower.contains(d))
                {
                    out.push(format!("{path}.{k}"));
                }
                dangerous(v, &format!("{path}.{k}"), out)
            }
        }
        Value::Array(values) => {
            for v in values {
                dangerous(v, path, out)
            }
        }
        _ => {}
    }
}
#[tauri::command]
fn export_data(state: State<AppState>, include_settings: bool) -> AppResult<Value> {
    let accounts = state.db.list_accounts()?;
    let settings = if include_settings {
        json!(get_settings(state)?)
    } else {
        Value::Null
    };
    Ok(
        json!({"schemaVersion":1,"exportedAt":Utc::now().to_rfc3339(),"accounts":accounts,"settings":settings}),
    )
}
#[tauri::command]
fn preview_import(state: State<AppState>, data: Value) -> AppResult<ImportPreview> {
    let mut blocked = Vec::new();
    dangerous(&data, "$", &mut blocked);
    if !blocked.is_empty() {
        return Ok(ImportPreview {
            added: 0,
            updated: 0,
            skipped: 0,
            blocked_fields: blocked,
        });
    }
    let existing = state.db.list_accounts()?;
    let items = data
        .get("accounts")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("IMPORT_INVALID", "导入文件缺少 accounts 数组"))?;
    let mut added = 0;
    let mut updated = 0;
    let mut skipped = 0;
    for item in items {
        if let Some(id) = item.get("steamId64").and_then(Value::as_str) {
            if validate_steam_id(id).is_err() {
                skipped += 1;
            } else if existing.iter().any(|a| a.steam_id64 == id) {
                updated += 1
            } else {
                added += 1
            }
        } else {
            skipped += 1
        }
    }
    Ok(ImportPreview {
        added,
        updated,
        skipped,
        blocked_fields: vec![],
    })
}
#[tauri::command]
fn apply_import(state: State<AppState>, data: Value, overwrite: bool) -> AppResult<ImportPreview> {
    let preview = preview_import(state.clone(), data.clone())?;
    if !preview.blocked_fields.is_empty() {
        return Err(AppError::new(
            "IMPORT_DANGEROUS_FIELDS",
            "导入文件包含敏感字段",
        ));
    }
    for item in data["accounts"].as_array().into_iter().flatten() {
        let id = item
            .get("steamId64")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if validate_steam_id(id).is_err() {
            continue;
        }
        let old = state
            .db
            .list_accounts()?
            .into_iter()
            .find(|a| a.steam_id64 == id);
        let pick = |key: &str, old: Option<String>| {
            if overwrite {
                item.get(key)
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or(old)
            } else {
                old.or_else(|| item.get(key).and_then(Value::as_str).map(str::to_owned))
            }
        };
        let input = ProfileInput {
            steam_id64: id.into(),
            alias: pick("alias", old.as_ref().and_then(|a| a.alias.clone())),
            remark: pick("remark", old.as_ref().and_then(|a| a.remark.clone())),
            group_name: pick("groupName", old.as_ref().and_then(|a| a.group_name.clone())),
            color: pick("color", old.as_ref().and_then(|a| a.color.clone())),
            favorite: if overwrite {
                item.get("favorite")
                    .and_then(Value::as_bool)
                    .unwrap_or_else(|| old.as_ref().map(|a| a.favorite).unwrap_or(false))
            } else {
                old.as_ref().map(|a| a.favorite).unwrap_or_else(|| {
                    item.get("favorite")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
            },
            tags: item
                .get("tags")
                .and_then(Value::as_array)
                .map(|v| {
                    v.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_else(|| old.as_ref().map(|a| a.tags.clone()).unwrap_or_default()),
        };
        state.db.save_profile(&input)?;
    }
    Ok(preview)
}
#[tauri::command]
fn restore_latest_backup(state: State<AppState>) -> AppResult<()> {
    steam::restore_latest(&steam_path(&state)?, &state.data_dir.join("backups"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app data path: {e}"))?;
            fs::create_dir_all(&data_dir)?;
            let db = Database::open(&data_dir.join("steam-account-manager.db"))
                .map_err(|e| e.message)?;
            app.manage(AppState {
                db,
                data_dir,
                switch_lock: AtomicBool::new(false),
                launch_lock: Mutex::new(()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            discover_steam,
            set_steam_path,
            scan_accounts,
            list_accounts,
            save_profile,
            delete_profile,
            list_platform_links,
            save_platform_link,
            delete_platform_link,
            current_status,
            switch_account,
            get_settings,
            set_setting,
            list_switch_logs,
            clear_switch_logs,
            save_platform_app,
            launch_platform,
            export_data,
            preview_import,
            apply_import,
            restore_latest_backup
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Steam Account Manager");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn masks_names() {
        assert_eq!(mask_name("abcdefgh"), "ab***gh");
        assert_eq!(mask_name("abc"), "***");
    }
    #[test]
    fn blocks_nested_secrets() {
        let mut out = vec![];
        dangerous(&json!({"nested":{"shared_secret":"x"}}), "$", &mut out);
        assert_eq!(out.len(), 1);
    }
}
