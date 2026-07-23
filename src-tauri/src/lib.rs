//! Tauri application composition and validated IPC command surface.
mod cs2;
mod database;
mod error;
mod models;
mod software;
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
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

pub struct AppState {
    db: Database,
    data_dir: PathBuf,
    switch_lock: AtomicBool,
    launch_lock: Mutex<()>,
    login_sessions: Mutex<BTreeMap<String, LoginSessionRecord>>,
    downloads: Arc<Mutex<BTreeMap<String, DownloadProgress>>>,
}

#[derive(Clone)]
struct LoginSessionRecord {
    started: Instant,
}
fn steam_path(state: &AppState) -> AppResult<PathBuf> {
    let value = state
        .db
        .setting("steam_path")?
        .ok_or_else(|| AppError::new("STEAM_NOT_CONFIGURED", "尚未配置 Steam 安装目录"))?;
    serde_json::from_str(&value).map_err(|_| AppError::new("SETTING_INVALID", "Steam 路径设置无效"))
}

fn select_steam_path(
    configured: Option<PathBuf>,
    discover: impl FnOnce() -> AppResult<Option<PathBuf>>,
) -> AppResult<Option<PathBuf>> {
    if let Some(path) = configured.filter(|path| steam::validate_dir(path).is_ok()) {
        return Ok(Some(path));
    }
    discover()
}

fn sync_local_accounts(state: &AppState, path: &Path) -> AppResult<usize> {
    let accounts = remembered_accounts(steam::read_accounts(path)?);
    steam::sync_avatar_cache(path, &state.data_dir.join("avatars"), &accounts)?;
    state.db.sync_accounts(&accounts)
}

fn auto_configure_platforms(state: &AppState) -> AppResult<usize> {
    let mut configured = 0;
    for app in steam::discover_platform_apps()? {
        if state.db.ensure_platform_app(&app)? {
            configured += 1;
        }
    }
    Ok(configured)
}

fn remembered_accounts(accounts: Vec<LocalSteamAccount>) -> Vec<LocalSteamAccount> {
    accounts
        .into_iter()
        .filter(|account| account.remember_password)
        .collect()
}

fn login_session_timed_out(elapsed: Duration) -> bool {
    elapsed >= Duration::from_secs(300)
}

#[tauri::command]
fn initialize_steam(state: State<AppState>) -> AppResult<StartupSteamResult> {
    let configured = state
        .db
        .setting("steam_path")?
        .and_then(|value| serde_json::from_str::<PathBuf>(&value).ok());
    let path = select_steam_path(configured, steam::discover)?;
    let Some(path) = path else {
        return Ok(StartupSteamResult {
            steam_path: None,
            scan_performed: false,
            account_count: 0,
            platform_count: auto_configure_platforms(&state)?,
        });
    };

    state.db.set_setting(
        "steam_path",
        &serde_json::to_string(&path)
            .map_err(|_| AppError::new("SETTING_INVALID", "无法保存 Steam 路径"))?,
    )?;
    let scan_performed = true;
    let account_count = sync_local_accounts(&state, &path)?;
    let platform_count = auto_configure_platforms(&state)?;
    Ok(StartupSteamResult {
        steam_path: Some(path.to_string_lossy().into_owned()),
        scan_performed,
        account_count,
        platform_count,
    })
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
    sync_local_accounts(&state, &steam_path(&state)?)
}
#[tauri::command]
fn list_accounts(state: State<AppState>) -> AppResult<Vec<Account>> {
    let mut accounts = state.db.list_accounts()?;
    let avatar_root = state.data_dir.join("avatars");
    for account in &mut accounts {
        if let Some(path) = steam::avatar_path(&avatar_root, &account.steam_id64) {
            account.avatar_path = Some(path.to_string_lossy().into_owned());
        }
    }
    Ok(accounts)
}
#[tauri::command]
fn save_profile(state: State<AppState>, input: ProfileInput) -> AppResult<()> {
    state.db.save_profile(&input)
}
#[tauri::command]
fn list_tags(state: State<AppState>) -> AppResult<Vec<TagOption>> {
    state.db.list_tags()
}

#[tauri::command]
fn begin_steam_login(state: State<AppState>) -> AppResult<SteamLoginSession> {
    {
        let mut sessions = state.login_sessions.lock();
        sessions.retain(|_, session| !login_session_timed_out(session.started.elapsed()));
        if !sessions.is_empty() {
            return Err(AppError::new(
                "STEAM_LOGIN_IN_PROGRESS",
                "已有 Steam 登录流程正在等待完成",
            ));
        }
    }
    let path = steam_path(&state)?;
    let shutdown_timeout = state
        .db
        .setting("shutdown_timeout")?
        .and_then(|value| serde_json::from_str::<u64>(&value).ok())
        .unwrap_or(15)
        .clamp(5, 120);
    fs::create_dir_all(state.data_dir.join("backups"))?;
    steam::begin_official_login(&path, &state.data_dir.join("backups"), shutdown_timeout)?;
    let id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339();
    state.login_sessions.lock().insert(
        id.clone(),
        LoginSessionRecord {
            started: Instant::now(),
        },
    );
    Ok(SteamLoginSession { id, started_at })
}

#[tauri::command]
fn get_steam_login_status(
    state: State<AppState>,
    session_id: String,
) -> AppResult<SteamLoginStatus> {
    let session = state
        .login_sessions
        .lock()
        .get(&session_id)
        .cloned()
        .ok_or_else(|| AppError::new("STEAM_LOGIN_SESSION_NOT_FOUND", "登录等待已结束或不存在"))?;
    if login_session_timed_out(session.started.elapsed()) {
        state.login_sessions.lock().remove(&session_id);
        return Ok(SteamLoginStatus {
            state: "timed_out".into(),
            account_id: None,
            message: Some("未检测到已记住的 Steam 登录，请重新尝试并勾选“记住我”".into()),
        });
    }
    let path = steam_path(&state)?;
    let Some(account) = steam::detect_official_login(&path)? else {
        return Ok(SteamLoginStatus {
            state: "pending".into(),
            account_id: None,
            message: None,
        });
    };
    sync_local_accounts(&state, &path)?;
    let account_id = state.db.account_id_by_steam_id(&account.steam_id64)?;
    state.login_sessions.lock().remove(&session_id);
    Ok(SteamLoginStatus {
        state: "completed".into(),
        account_id,
        message: Some("Steam 登录已完成，账号列表已刷新".into()),
    })
}

#[tauri::command]
fn cancel_steam_login(state: State<AppState>, session_id: String) -> AppResult<()> {
    state.login_sessions.lock().remove(&session_id);
    Ok(())
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
        let dir = steam_path(&state)?;
        let backup = state.data_dir.join("backups");
        fs::create_dir_all(&backup)?;
        let shutdown_timeout = state
            .db
            .setting("shutdown_timeout")?
            .and_then(|value| serde_json::from_str::<u64>(&value).ok())
            .unwrap_or(15)
            .clamp(5, 120);
        let startup_timeout = state
            .db
            .setting("startup_timeout")?
            .and_then(|value| serde_json::from_str::<u64>(&value).ok())
            .unwrap_or(20)
            .clamp(5, 120);
        steam::shutdown(&dir, shutdown_timeout)?;
        cs2::prepare_for_switch(&state.db, &state.data_dir, &dir, &steam_id64)?;
        steam::switch(
            &dir,
            &backup,
            &steam_id64,
            shutdown_timeout,
            startup_timeout,
        )?;
        state.db.mark_switched(&steam_id64)?;
        for app in state.db.list_platform_apps()?.into_iter() {
            steam::restart_platform(&app, shutdown_timeout)?;
        }
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
    if key == "theme"
        && !value.as_str().is_some_and(|theme| {
            ["aurora", "violet", "mint", "glacier", "daylight", "lilac"].contains(&theme)
        })
    {
        return Err(AppError::new("SETTING_INVALID", "界面主题无效"));
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
fn list_platform_apps(state: State<AppState>) -> AppResult<Vec<PlatformApp>> {
    state.db.list_platform_apps()
}

#[tauri::command]
fn discover_platform_apps() -> AppResult<Vec<PlatformApp>> {
    steam::discover_platform_apps()
}

#[tauri::command]
fn discover_cs2_configs(state: State<AppState>) -> AppResult<Vec<Cs2Config>> {
    steam::discover_cs2_configs(&steam_path(&state)?)
}

#[tauri::command]
fn list_cfg_profiles(state: State<AppState>) -> AppResult<Vec<CfgProfile>> {
    state.db.list_cfg_profiles()
}

#[tauri::command]
fn create_cfg_profile(
    state: State<AppState>,
    name: String,
    file_name: String,
    content: String,
) -> AppResult<CfgProfile> {
    let name = name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(AppError::new(
            "CFG_NAME_INVALID",
            "cfg 方案名称不能为空或超过 80 字符",
        ));
    }
    let file_name = cs2::validate_cfg_file_name(&file_name)?;
    let profile = state.db.create_cfg_profile(name, &file_name, &content)?;
    if let Err(error) = cs2::write_managed_profile(&state.data_dir, &profile) {
        let _ = state.db.delete_cfg_profile(&profile.id);
        return Err(error);
    }
    Ok(profile)
}

#[tauri::command]
fn import_cfg_profile(state: State<AppState>, path: String) -> AppResult<CfgProfile> {
    let path = PathBuf::from(path);
    if !path.is_file() || fs::metadata(&path)?.len() > 2 * 1024 * 1024 {
        return Err(AppError::new(
            "CFG_IMPORT_INVALID",
            "请选择不超过 2 MB 的 cfg 文件",
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::new("CFG_IMPORT_INVALID", "cfg 文件名无效"))?;
    let file_name = cs2::validate_cfg_file_name(file_name)?;
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("导入配置");
    let content = fs::read_to_string(&path)
        .map_err(|_| AppError::new("CFG_IMPORT_ENCODING", "cfg 文件不是有效 UTF-8 文本"))?;
    create_cfg_profile(state, name.to_string(), file_name, content)
}

#[tauri::command]
fn save_cfg_profile(
    state: State<AppState>,
    id: String,
    name: String,
    content: String,
) -> AppResult<()> {
    if content.len() > 2 * 1024 * 1024 {
        return Err(AppError::new("CFG_TOO_LARGE", "cfg 内容不能超过 2 MB"));
    }
    state.db.save_cfg_profile(&id, name.trim(), &content)?;
    let profile = state
        .db
        .list_cfg_profiles()?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| AppError::new("CFG_PROFILE_NOT_FOUND", "找不到该 cfg 方案"))?;
    cs2::write_managed_profile(&state.data_dir, &profile)
}

#[tauri::command]
fn delete_cfg_profile(state: State<AppState>, id: String) -> AppResult<()> {
    if let Some(profile) = state
        .db
        .list_cfg_profiles()?
        .into_iter()
        .find(|profile| profile.id == id)
    {
        let _ = fs::remove_file(cs2::managed_file(&state.data_dir, &profile.file_name));
    }
    state.db.delete_cfg_profile(&id)
}

#[tauri::command]
fn assign_cfg_profile(
    state: State<AppState>,
    steam_account_id: String,
    profile_id: Option<String>,
) -> AppResult<()> {
    if let Some(profile_id) = profile_id.filter(|value| !value.is_empty()) {
        state.db.assign_cfg_profile(&steam_account_id, &profile_id)
    } else {
        state.db.remove_cfg_assignment(&steam_account_id)
    }
}

#[tauri::command]
fn list_cfg_assignments(state: State<AppState>) -> AppResult<Vec<AccountCfgAssignment>> {
    state.db.list_cfg_assignments()
}

#[tauri::command]
fn list_cfg_versions(
    state: State<AppState>,
    profile_id: String,
) -> AppResult<Vec<CfgProfileVersion>> {
    state.db.list_cfg_versions(&profile_id)
}

#[tauri::command]
fn restore_cfg_version(
    state: State<AppState>,
    profile_id: String,
    version_id: String,
) -> AppResult<String> {
    state.db.restore_cfg_version(&profile_id, &version_id)
}

#[tauri::command]
fn list_cs2_runtime_files(state: State<AppState>) -> AppResult<Vec<Cs2RuntimeFile>> {
    cs2::list_runtime_files(&steam_path(&state)?)
}

#[tauri::command]
fn preview_cs2_runtime_file(state: State<AppState>, path: String) -> AppResult<String> {
    cs2::preview_runtime_file(&steam_path(&state)?, Path::new(&path))
}

#[tauri::command]
fn list_software_statuses(state: State<AppState>) -> AppResult<Vec<SoftwareStatus>> {
    let configured = state.db.list_platform_apps()?;
    let discovered = steam::discover_platform_apps()?;
    let platform = |code: &str, name: &str, official_url: &str, download_mode: &str| {
        let path = configured
            .iter()
            .chain(discovered.iter())
            .find(|app| app.platform_code == code && Path::new(&app.executable_path).is_file())
            .map(|app| app.executable_path.clone());
        SoftwareStatus {
            code: code.to_string(),
            name: name.to_string(),
            installed: path.is_some(),
            executable_path: path,
            download_mode: download_mode.to_string(),
            official_url: official_url.to_string(),
        }
    };
    let teamspeak = software::discover_teamspeak();
    Ok(vec![
        platform(
            "perfectworld",
            "完美世界竞技平台",
            software::PERFECT_DOWNLOAD_PAGE,
            "managed",
        ),
        platform(
            "5e",
            "5E 对战平台",
            software::FIVE_E_DOWNLOAD_PAGE,
            "browser_fallback",
        ),
        SoftwareStatus {
            code: "teamspeak3".to_string(),
            name: "TeamSpeak 3".to_string(),
            installed: teamspeak.is_some(),
            executable_path: teamspeak.map(|path| path.to_string_lossy().into_owned()),
            download_mode: "managed".to_string(),
            official_url: software::TEAMSPEAK_DOWNLOAD_PAGE.to_string(),
        },
    ])
}

#[tauri::command]
fn list_download_progress(state: State<AppState>) -> Vec<DownloadProgress> {
    state.downloads.lock().values().cloned().collect()
}

#[tauri::command]
fn start_software_download(
    app: tauri::AppHandle,
    state: State<AppState>,
    code: String,
) -> AppResult<()> {
    if code == "5e" {
        return Err(AppError::new(
            "DOWNLOAD_BROWSER_REQUIRED",
            "5E 官方下载需要在浏览器中完成安全验证",
        )
        .detail(software::FIVE_E_DOWNLOAD_PAGE));
    }
    if !["perfectworld", "teamspeak3"].contains(&code.as_str()) {
        return Err(AppError::new("SOFTWARE_NOT_SUPPORTED", "不支持该软件下载"));
    }
    let downloads = Arc::clone(&state.downloads);
    if downloads
        .lock()
        .get(&code)
        .is_some_and(|progress| matches!(progress.state.as_str(), "downloading" | "installing"))
    {
        return Err(AppError::new(
            "DOWNLOAD_IN_PROGRESS",
            "该软件正在下载或安装",
        ));
    }
    let initial = DownloadProgress {
        code: code.clone(),
        state: "starting".to_string(),
        downloaded: 0,
        total: None,
        message: None,
    };
    downloads.lock().insert(code.clone(), initial.clone());
    let _ = app.emit("software-download-progress", &initial);
    let directory = state.data_dir.join("downloads");
    std::thread::spawn(move || {
        let result = software::download_and_install(&code, &directory, |progress| {
            downloads.lock().insert(code.clone(), progress.clone());
            let _ = app.emit("software-download-progress", &progress);
        });
        let final_progress = match result {
            Ok(()) => DownloadProgress {
                code: code.clone(),
                state: "completed".to_string(),
                downloaded: 0,
                total: None,
                message: Some("安装程序已结束，安装包已删除".to_string()),
            },
            Err(error) => DownloadProgress {
                code: code.clone(),
                state: "failed".to_string(),
                downloaded: 0,
                total: None,
                message: Some(error.message),
            },
        };
        let _ = app.emit("software-download-progress", &final_progress);
        if final_progress.state == "completed" {
            downloads.lock().remove(&code);
        } else {
            downloads.lock().insert(code.clone(), final_progress);
        }
    });
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
    let items = data
        .get("accounts")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("IMPORT_INVALID", "导入文件缺少 accounts 数组"))?;
    let added = 0;
    let mut updated = 0;
    let mut skipped = 0;
    for item in items {
        if let Some(id) = item.get("steamId64").and_then(Value::as_str) {
            if validate_steam_id(id).is_err() {
                skipped += 1;
            } else if state.db.account_id_by_steam_id(id)?.is_some() {
                updated += 1
            } else {
                skipped += 1
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
        let Some(account_id) = state.db.account_id_by_steam_id(id)? else {
            continue;
        };
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
            account_id,
            alias: pick("alias", old.as_ref().and_then(|a| a.alias.clone())),
            remark: pick("remark", old.as_ref().and_then(|a| a.remark.clone())),
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
                login_sessions: Mutex::new(BTreeMap::new()),
                downloads: Arc::new(Mutex::new(BTreeMap::new())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize_steam,
            discover_steam,
            set_steam_path,
            scan_accounts,
            list_accounts,
            save_profile,
            list_tags,
            begin_steam_login,
            get_steam_login_status,
            cancel_steam_login,
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
            list_platform_apps,
            discover_platform_apps,
            discover_cs2_configs,
            list_cfg_profiles,
            create_cfg_profile,
            import_cfg_profile,
            save_cfg_profile,
            delete_cfg_profile,
            assign_cfg_profile,
            list_cfg_assignments,
            list_cfg_versions,
            restore_cfg_version,
            list_cs2_runtime_files,
            preview_cs2_runtime_file,
            list_software_statuses,
            list_download_progress,
            start_software_download,
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
    use std::cell::Cell;

    fn fake_steam_dir() -> tempfile::TempDir {
        let directory = tempfile::tempdir().expect("temporary Steam directory");
        fs::write(directory.path().join("steam.exe"), []).expect("fake steam.exe");
        fs::create_dir_all(directory.path().join("config")).expect("config directory");
        fs::write(
            directory.path().join("config/loginusers.vdf"),
            "\"users\" {}",
        )
        .expect("fake loginusers.vdf");
        directory
    }

    #[test]
    fn startup_prefers_valid_configured_path() {
        let configured = fake_steam_dir();
        let discovery_called = Cell::new(false);
        let selected = select_steam_path(Some(configured.path().to_path_buf()), || {
            discovery_called.set(true);
            Ok(None)
        })
        .expect("select path");
        assert_eq!(selected.as_deref(), Some(configured.path()));
        assert!(!discovery_called.get());
    }

    #[test]
    fn startup_falls_back_when_configured_path_is_invalid() {
        let discovered = fake_steam_dir();
        let selected = select_steam_path(Some(PathBuf::from("missing-steam")), || {
            Ok(Some(discovered.path().to_path_buf()))
        })
        .expect("select path");
        assert_eq!(selected.as_deref(), Some(discovered.path()));
    }

    #[test]
    fn startup_allows_steam_to_be_absent() {
        assert_eq!(
            select_steam_path(None, || Ok(None)).expect("select path"),
            None
        );
    }

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

    #[test]
    fn scan_ignores_accounts_without_remembered_credentials() {
        let account = |steam_id64: &str, remember_password: bool| LocalSteamAccount {
            steam_id64: steam_id64.into(),
            account_name: None,
            persona_name: None,
            remember_password,
            allow_auto_login: false,
            most_recent: false,
            timestamp: None,
        };
        let filtered = remembered_accounts(vec![
            account("76561198000000001", true),
            account("76561198000000002", false),
        ]);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].steam_id64, "76561198000000001");
    }

    #[test]
    fn official_login_session_times_out_at_five_minutes() {
        assert!(!login_session_timed_out(Duration::from_secs(299)));
        assert!(login_session_timed_out(Duration::from_secs(300)));
    }
}
