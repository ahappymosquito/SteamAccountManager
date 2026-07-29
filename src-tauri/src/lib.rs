//! Tauri application composition and validated IPC command surface.
mod app_update;
mod cs2;
mod database;
mod error;
mod models;
mod player_query;
mod software;
mod steam;

use crate::database::{validate_steam_id, Database};
use crate::error::{AppError, AppResult};
use crate::models::*;
use app_update::AppUpdateState;
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
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

const PLAYER_CACHE_TTL_MINUTES: i64 = 15;
const FIVE_E_REFRESH_INTERVAL: Duration = Duration::from_secs(15 * 60);

pub struct AppState {
    db: Arc<Database>,
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

fn player_snapshot_cache(
    db: &Database,
    platform_link_id: &str,
) -> AppResult<Option<(PlayerSnapshot, String)>> {
    Ok(db
        .player_snapshot_cache(platform_link_id)?
        .and_then(|(payload, expires_at)| {
            serde_json::from_str::<PlayerSnapshot>(&payload)
                .ok()
                .map(|snapshot| (snapshot, expires_at))
        }))
}

fn cached_snapshot_is_usable(
    platform_code: &str,
    force_refresh: bool,
    expires_at: &str,
    now: chrono::DateTime<Utc>,
) -> bool {
    !force_refresh
        && (platform_code == "5e"
            || chrono::DateTime::parse_from_rfc3339(expires_at).is_ok_and(|expires| expires > now))
}

fn refresh_player_link(
    db: &Database,
    link: PlatformLink,
    cached: Option<(PlayerSnapshot, String)>,
) -> AppResult<PlayerSnapshot> {
    let external_id = link
        .external_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("PLAYER_ID_MISSING", "请先填写平台玩家标识"))?
        .to_string();
    let token = player_query::load_credential(&link.platform_code)?;
    let query = player_query::PlayerQuery::new()?;
    let fetched = match link.platform_code.as_str() {
        "5e" => query.query_five_e(&external_id, token.as_deref()),
        "perfectworld" => query.query_perfect_world(&external_id, token.as_deref()),
        _ => {
            return Err(AppError::new(
                "PLAYER_PLATFORM_UNSUPPORTED",
                "该平台暂不支持玩家数据查询",
            ))
        }
    };

    match fetched {
        Ok((snapshot, token_expired)) => {
            let verified = snapshot.platform != "perfectworld"
                || snapshot
                    .capabilities
                    .iter()
                    .any(|capability| capability == "season_ladder");
            db.save_link(&PlatformLinkInput {
                id: Some(link.id.clone()),
                steam_account_id: link.steam_account_id,
                platform_code: link.platform_code.clone(),
                external_id: Some(snapshot.external_id.clone()),
                display_name: snapshot.nickname.clone().or(link.display_name),
                profile_url: link.profile_url,
                remark: link.remark,
                status: if verified {
                    "user_confirmed".to_string()
                } else {
                    "unverified".to_string()
                },
            })?;
            db.set_setting(
                &format!("credential.{}.expired", link.platform_code),
                if token_expired { "true" } else { "false" },
            )?;
            let expires_at =
                (Utc::now() + chrono::Duration::minutes(PLAYER_CACHE_TTL_MINUTES)).to_rfc3339();
            let payload = serde_json::to_string(&snapshot)
                .map_err(|_| AppError::new("PLAYER_CACHE_FAILED", "无法保存玩家数据缓存"))?;
            db.save_player_snapshot_cache(&link.id, &payload, &snapshot.fetched_at, &expires_at)?;
            Ok(snapshot)
        }
        Err(error) => {
            if error.code == "PLAYER_CREDENTIAL_EXPIRED" {
                db.set_setting(
                    &format!("credential.{}.expired", link.platform_code),
                    "true",
                )?;
            }
            if let Some((mut snapshot, _)) = cached {
                snapshot.stale = true;
                snapshot
                    .warnings
                    .push(format!("刷新失败，正在显示缓存数据：{}", error.message));
                Ok(snapshot)
            } else {
                Err(error)
            }
        }
    }
}

fn refresh_all_linked_five_e_players(db: &Database) {
    let Ok(links) = db.refreshable_five_e_links() else {
        return;
    };
    for link in links {
        let cached = player_snapshot_cache(db, &link.id).ok().flatten();
        let _ = refresh_player_link(db, link, cached);
    }
}

fn start_five_e_refresh_worker(db: Arc<Database>) -> std::io::Result<()> {
    thread::Builder::new()
        .name("five-e-player-refresh".to_string())
        .spawn(move || loop {
            let cycle_started = Instant::now();
            refresh_all_linked_five_e_players(&db);
            thread::sleep(FIVE_E_REFRESH_INTERVAL.saturating_sub(cycle_started.elapsed()));
        })
        .map(|_| ())
}

#[tauri::command]
async fn query_player_data(
    state: State<'_, AppState>,
    platform_link_id: String,
    force_refresh: bool,
) -> AppResult<PlayerSnapshot> {
    let link = state
        .db
        .platform_link(&platform_link_id)?
        .ok_or_else(|| AppError::new("PLATFORM_LINK_NOT_FOUND", "平台关联不存在"))?;
    if !matches!(link.platform_code.as_str(), "5e" | "perfectworld") {
        return Err(AppError::new(
            "PLAYER_PLATFORM_UNSUPPORTED",
            "该平台暂不支持玩家数据查询",
        ));
    }
    let cached = player_snapshot_cache(&state.db, &platform_link_id)?;
    if let Some((mut snapshot, expires_at)) = cached.clone() {
        if cached_snapshot_is_usable(&link.platform_code, force_refresh, &expires_at, Utc::now()) {
            if link.platform_code == "5e"
                && chrono::DateTime::parse_from_rfc3339(&expires_at)
                    .is_ok_and(|expires| expires <= Utc::now())
            {
                snapshot.stale = true;
                snapshot
                    .warnings
                    .push("后台定时刷新尚未完成，正在显示上次数据".to_string());
            }
            return Ok(snapshot);
        }
    }

    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || refresh_player_link(&db, link, cached))
        .await
        .map_err(|_| AppError::new("PLAYER_QUERY_FAILED", "玩家数据后台查询失败"))?
}

#[tauri::command]
async fn auto_link_perfectworld(
    state: State<'_, AppState>,
    steam_account_id: String,
    force_refresh: bool,
) -> AppResult<PlayerSnapshot> {
    let (steam_id64, persona_name) = state
        .db
        .account_identity(&steam_account_id)?
        .ok_or_else(|| AppError::new("ACCOUNT_NOT_FOUND", "Steam 账号不存在"))?;
    validate_steam_id(&steam_id64)?;
    if let Some(link) = state
        .db
        .list_links(&steam_account_id)?
        .into_iter()
        .find(|link| link.platform_code == "perfectworld")
    {
        if link.external_id.as_deref().map(str::trim) != Some(steam_id64.as_str()) {
            state.db.save_link(&PlatformLinkInput {
                id: Some(link.id.clone()),
                steam_account_id: link.steam_account_id.clone(),
                platform_code: link.platform_code.clone(),
                external_id: Some(steam_id64),
                display_name: link.display_name.clone().or(persona_name),
                profile_url: link.profile_url.clone(),
                remark: link.remark.clone(),
                status: "unverified".to_string(),
            })?;
        }
        return query_player_data(state, link.id, force_refresh).await;
    }
    if player_query::load_credential("perfectworld")?.is_none() {
        return Err(AppError::new(
            "PLAYER_CREDENTIAL_REQUIRED",
            "请先在设置中配置完美平台 Access Token",
        ));
    }

    let link_id = Uuid::new_v4().to_string();
    state.db.save_link(&PlatformLinkInput {
        id: Some(link_id.clone()),
        steam_account_id: steam_account_id.clone(),
        platform_code: "perfectworld".to_string(),
        external_id: Some(steam_id64),
        display_name: persona_name,
        profile_url: None,
        remark: None,
        status: "unverified".to_string(),
    })?;
    let database = Arc::clone(&state.db);
    let result = query_player_data(state, link_id.clone(), force_refresh).await;
    if result.is_err() {
        let _ = database.delete_link(&link_id);
    }
    result
}

#[tauri::command]
fn save_platform_credential(
    state: State<AppState>,
    platform_code: String,
    token: Option<String>,
) -> AppResult<()> {
    player_query::save_credential(&platform_code, token.as_deref())?;
    if matches!(platform_code.as_str(), "5e" | "perfectworld") {
        state
            .db
            .set_setting(&format!("credential.{platform_code}.expired"), "false")?;
    }
    Ok(())
}

#[tauri::command]
fn get_platform_credential_status(
    state: State<AppState>,
    platform_code: String,
) -> AppResult<PlatformCredentialStatus> {
    if !matches!(platform_code.as_str(), "5e" | "perfectworld") {
        return Err(AppError::new(
            "PLAYER_PLATFORM_UNSUPPORTED",
            "该平台暂不支持玩家数据凭据",
        ));
    }
    let expired = state
        .db
        .setting(&format!("credential.{platform_code}.expired"))?
        .is_some_and(|value| value == "true");
    player_query::credential_status(&platform_code, expired)
}
#[tauri::command]
fn current_status(state: State<AppState>) -> CurrentStatus {
    let path = steam_path(&state).ok();
    steam::status(path.as_deref())
}

trait SwitchWorkflowExecutor {
    fn shutdown_steam(&mut self) -> AppResult<()>;
    fn prepare_cs2_config(&mut self) -> AppResult<()>;
    fn switch_steam_account(&mut self) -> AppResult<()>;
    fn record_switch(&mut self) -> AppResult<()>;
    fn restart_five_e(&mut self) -> AppResult<()>;
}

fn execute_switch_workflow(
    executor: &mut impl SwitchWorkflowExecutor,
    cs2_installed: bool,
    restart_five_e: bool,
) -> AppResult<Vec<String>> {
    executor.shutdown_steam()?;
    if cs2_installed {
        executor.prepare_cs2_config()?;
    }
    executor.switch_steam_account()?;
    executor.record_switch()?;
    let mut warnings = Vec::new();
    if restart_five_e {
        if let Err(error) = executor.restart_five_e() {
            warnings.push(format!(
                "Steam 账号已切换，但 5E 未能启动或重启：{}",
                error.message
            ));
        }
    }
    Ok(warnings)
}

struct LocalSwitchWorkflowExecutor<'a> {
    state: &'a AppState,
    steam_dir: &'a Path,
    backup_dir: &'a Path,
    steam_id64: &'a str,
    shutdown_timeout: u64,
    startup_timeout: u64,
}

impl SwitchWorkflowExecutor for LocalSwitchWorkflowExecutor<'_> {
    fn shutdown_steam(&mut self) -> AppResult<()> {
        steam::shutdown(self.steam_dir, self.shutdown_timeout)
    }

    fn prepare_cs2_config(&mut self) -> AppResult<()> {
        cs2::prepare_for_switch(
            &self.state.db,
            &self.state.data_dir,
            self.steam_dir,
            self.steam_id64,
        )
        .map(|_| ())
    }

    fn switch_steam_account(&mut self) -> AppResult<()> {
        steam::switch(
            self.steam_dir,
            self.backup_dir,
            self.steam_id64,
            self.shutdown_timeout,
            self.startup_timeout,
        )
    }

    fn record_switch(&mut self) -> AppResult<()> {
        self.state.db.mark_switched(self.steam_id64)
    }

    fn restart_five_e(&mut self) -> AppResult<()> {
        let app = resolve_software_app(self.state, "5e")?;
        steam::restart_five_e(&app, Duration::from_secs(10))
    }
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
    let result = (|| -> AppResult<(Account, Vec<String>)> {
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
        let cs2_installed = cs2::is_installed(&dir);
        let mut executor = LocalSwitchWorkflowExecutor {
            state: state.inner(),
            steam_dir: &dir,
            backup_dir: &backup,
            steam_id64: &steam_id64,
            shutdown_timeout,
            startup_timeout,
        };
        let restart_five_e = account.platform_codes.iter().any(|code| code == "5e");
        let warnings = execute_switch_workflow(&mut executor, cs2_installed, restart_five_e)?;
        Ok((account, warnings))
    })();
    state.switch_lock.store(false, Ordering::Release);
    let finished = Utc::now().to_rfc3339();
    let (outcome, message, account_id, masked) = match &result {
        Ok((account, warnings)) if warnings.is_empty() => (
            "success",
            if account.platform_codes.iter().any(|code| code == "5e") {
                "Steam 已按目标账号重新启动，5E 已启动或重启".to_string()
            } else {
                "Steam 已按目标账号重新启动；未启动 CS2".to_string()
            },
            Some(account.id.clone()),
            account.account_name.as_deref().map(mask_name),
        ),
        Ok((account, warnings)) => (
            "success_with_warning",
            warnings.join("；"),
            Some(account.id.clone()),
            account.account_name.as_deref().map(mask_name),
        ),
        Err(e) => ("failed", e.message.clone(), None, None),
    };
    state.db.0.lock().execute("INSERT INTO switch_logs(id,steam_account_id,account_name,started_at,finished_at,result,error_message) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,account_id,masked,started,finished,outcome,if outcome=="failed" || outcome=="success_with_warning"{Some(message.clone())}else{None}])?;
    result.map(|(_, warnings)| SwitchResult {
        success: true,
        stage: if warnings.is_empty() {
            "completed".into()
        } else {
            "completed_with_warning".into()
        },
        message,
        warnings,
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
        "cfg_command_definitions",
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
    if key == "cfg_command_definitions"
        && (!value.is_array() || value.to_string().len() > 2 * 1024 * 1024)
    {
        return Err(AppError::new(
            "SETTING_INVALID",
            "CFG 参数定义必须是且不超过 2 MB 的数组",
        ));
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
    if !["perfectworld", "5e", "teamspeak3", "faceit", "other"]
        .contains(&app.platform_code.as_str())
    {
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
    state.db.ensure_active_cfg_profile()?;
    state.db.list_cfg_profiles()
}

#[tauri::command]
fn get_active_cfg_profile(state: State<AppState>) -> AppResult<CfgProfile> {
    state.db.active_cfg_profile()
}

#[tauri::command]
fn set_active_cfg_profile(state: State<AppState>, id: String) -> AppResult<CfgProfile> {
    state.db.set_active_cfg_profile(&id)
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
    state.db.set_active_cfg_profile(&profile.id)?;
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
    let requested = cs2::validate_cfg_file_name(file_name)?;
    let existing = state
        .db
        .list_cfg_profiles()?
        .into_iter()
        .map(|profile| profile.file_name)
        .collect::<Vec<_>>();
    let file_name = cs2::unique_cfg_file_name(&requested, &existing);
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
fn export_cfg_profile(state: State<AppState>, id: String, path: String) -> AppResult<String> {
    let profile = state
        .db
        .list_cfg_profiles()?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| AppError::new("CFG_PROFILE_NOT_FOUND", "找不到该 CFG 方案"))?;
    cs2::export_profile(&PathBuf::from(path), &profile.content)
        .map(|exported| exported.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_cfg_definition_file(path: String) -> AppResult<String> {
    cs2::read_definition_file(&PathBuf::from(path))
}

#[tauri::command]
fn write_cfg_definition_file(path: String, content: String) -> AppResult<String> {
    cs2::write_definition_file(&PathBuf::from(path), &content)
        .map(|exported| exported.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_cfg_profile(state: State<AppState>, id: String) -> AppResult<()> {
    let profile = state
        .db
        .list_cfg_profiles()?
        .into_iter()
        .find(|profile| profile.id == id);
    state.db.delete_cfg_profile_and_repair_active(&id)?;
    if let Some(profile) = profile {
        let _ = fs::remove_file(cs2::managed_file(&state.data_dir, &profile.file_name));
    }
    Ok(())
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

fn resolve_teamspeak_app_with(
    configured: &[PlatformApp],
    discover: impl FnOnce() -> Option<PathBuf>,
) -> Option<PlatformApp> {
    configured
        .iter()
        .find(|app| {
            app.platform_code == "teamspeak3"
                && Path::new(&app.executable_path).is_file()
                && Path::new(&app.executable_path)
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
        })
        .cloned()
        .or_else(|| {
            let path = discover()?;
            Some(PlatformApp {
                platform_code: "teamspeak3".to_string(),
                name: "TeamSpeak 3".to_string(),
                executable_path: path.to_string_lossy().into_owned(),
                arguments: vec![],
                working_directory: path
                    .parent()
                    .map(|value| value.to_string_lossy().into_owned()),
                prelaunch_check: false,
            })
        })
}

fn resolve_teamspeak_app(configured: &[PlatformApp]) -> Option<PlatformApp> {
    resolve_teamspeak_app_with(configured, software::discover_teamspeak)
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
    let teamspeak = resolve_teamspeak_app(&configured);
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
            executable_path: teamspeak.map(|app| app.executable_path),
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
fn open_official_url(code: String) -> AppResult<()> {
    software::open_official(&code)
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

fn resolve_software_app(state: &AppState, code: &str) -> AppResult<PlatformApp> {
    if code == "teamspeak3" {
        let configured = state.db.list_platform_apps()?;
        return resolve_teamspeak_app(&configured)
            .ok_or_else(|| AppError::new("SOFTWARE_NOT_INSTALLED", "未检测到 TeamSpeak 3"));
    }
    if !["perfectworld", "5e"].contains(&code) {
        return Err(AppError::new("SOFTWARE_NOT_SUPPORTED", "不支持启动该软件"));
    }
    state
        .db
        .list_platform_apps()?
        .into_iter()
        .chain(steam::discover_platform_apps()?)
        .find(|app| app.platform_code == code && Path::new(&app.executable_path).is_file())
        .ok_or_else(|| AppError::new("SOFTWARE_NOT_INSTALLED", "未检测到该平台软件"))
}

#[tauri::command]
fn launch_software(state: State<AppState>, code: String) -> AppResult<()> {
    let _guard = state
        .launch_lock
        .try_lock()
        .ok_or_else(|| AppError::new("LAUNCH_IN_PROGRESS", "已有程序启动任务正在进行"))?;
    let app = resolve_software_app(&state, &code)?;
    steam::launch_platform(&app)
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app data path: {e}"))?;
            fs::create_dir_all(&data_dir)?;
            let db = Database::open(&data_dir.join("steam-account-manager.db"))
                .map_err(|e| e.message)?;
            let db = Arc::new(db);
            start_five_e_refresh_worker(Arc::clone(&db))
                .map_err(|error| format!("5E refresh worker: {error}"))?;
            app.manage(AppState {
                db,
                data_dir,
                switch_lock: AtomicBool::new(false),
                launch_lock: Mutex::new(()),
                login_sessions: Mutex::new(BTreeMap::new()),
                downloads: Arc::new(Mutex::new(BTreeMap::new())),
            });
            app.manage(AppUpdateState::default());
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
            query_player_data,
            auto_link_perfectworld,
            save_platform_credential,
            get_platform_credential_status,
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
            get_active_cfg_profile,
            set_active_cfg_profile,
            create_cfg_profile,
            import_cfg_profile,
            save_cfg_profile,
            export_cfg_profile,
            read_cfg_definition_file,
            write_cfg_definition_file,
            delete_cfg_profile,
            assign_cfg_profile,
            list_cfg_assignments,
            list_software_statuses,
            list_download_progress,
            open_official_url,
            start_software_download,
            launch_software,
            launch_platform,
            export_data,
            preview_import,
            apply_import,
            restore_latest_backup,
            app_update::check_app_update,
            app_update::install_app_update
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
    fn teamspeak_resolution_prefers_a_valid_configured_executable() {
        let installation = tempfile::tempdir().expect("temporary TeamSpeak installation");
        let executable = installation.path().join("custom-ts3.exe");
        fs::write(&executable, []).expect("fake configured TeamSpeak executable");
        let configured = PlatformApp {
            platform_code: "teamspeak3".to_string(),
            name: "TeamSpeak 3".to_string(),
            executable_path: executable.to_string_lossy().into_owned(),
            arguments: vec!["-nosingleinstance".to_string()],
            working_directory: Some(installation.path().to_string_lossy().into_owned()),
            prelaunch_check: true,
        };
        let discovery_called = Cell::new(false);

        let resolved = resolve_teamspeak_app_with(std::slice::from_ref(&configured), || {
            discovery_called.set(true);
            None
        })
        .expect("configured TeamSpeak app");

        assert_eq!(resolved.executable_path, configured.executable_path);
        assert_eq!(resolved.arguments, configured.arguments);
        assert!(!discovery_called.get());
    }

    #[test]
    fn teamspeak_resolution_discovers_when_the_configured_path_is_invalid() {
        let installation = tempfile::tempdir().expect("temporary TeamSpeak installation");
        let executable = installation.path().join("ts3client_win64.exe");
        fs::write(&executable, []).expect("fake discovered TeamSpeak executable");
        let configured = PlatformApp {
            platform_code: "teamspeak3".to_string(),
            name: "TeamSpeak 3".to_string(),
            executable_path: "missing-ts3.exe".to_string(),
            arguments: vec![],
            working_directory: None,
            prelaunch_check: true,
        };

        let resolved = resolve_teamspeak_app_with(&[configured], || Some(executable.clone()))
            .expect("discovered TeamSpeak app");

        assert_eq!(resolved.executable_path, executable.to_string_lossy());
        assert!(resolved.arguments.is_empty());
        assert_eq!(
            resolved.working_directory.as_deref(),
            Some(installation.path().to_string_lossy().as_ref())
        );
    }

    #[test]
    fn five_e_details_use_cached_data_until_the_background_worker_replaces_it() {
        let now = Utc::now();
        let expired = (now - chrono::Duration::minutes(1)).to_rfc3339();
        assert!(cached_snapshot_is_usable("5e", false, &expired, now));
        assert!(!cached_snapshot_is_usable("5e", true, &expired, now));
        assert!(!cached_snapshot_is_usable(
            "perfectworld",
            false,
            &expired,
            now
        ));
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

    #[test]
    fn switch_prepares_cfg_without_launching_the_game_or_platforms() {
        let mut executor = RecordingSwitchWorkflowExecutor::default();

        let warnings =
            execute_switch_workflow(&mut executor, true, false).expect("switch workflow");

        assert!(warnings.is_empty());
        assert_eq!(
            executor.operations,
            vec![
                SwitchOperation::ShutdownSteam,
                SwitchOperation::PrepareCs2Config,
                SwitchOperation::SwitchSteamAccount,
                SwitchOperation::RecordSwitch,
            ]
        );
    }

    #[test]
    fn switch_skips_cfg_preparation_when_cs2_is_not_installed() {
        let mut executor = RecordingSwitchWorkflowExecutor::default();

        execute_switch_workflow(&mut executor, false, false).expect("switch workflow");

        assert_eq!(
            executor.operations,
            vec![
                SwitchOperation::ShutdownSteam,
                SwitchOperation::SwitchSteamAccount,
                SwitchOperation::RecordSwitch,
            ]
        );
    }

    #[test]
    fn switch_restarts_five_e_only_for_linked_accounts() {
        let mut executor = RecordingSwitchWorkflowExecutor::default();

        let warnings =
            execute_switch_workflow(&mut executor, false, true).expect("switch workflow");

        assert!(warnings.is_empty());
        assert_eq!(
            executor.operations,
            vec![
                SwitchOperation::ShutdownSteam,
                SwitchOperation::SwitchSteamAccount,
                SwitchOperation::RecordSwitch,
                SwitchOperation::RestartFiveE,
            ]
        );
    }

    #[test]
    fn five_e_restart_failure_keeps_the_steam_switch_successful() {
        let mut executor = RecordingSwitchWorkflowExecutor {
            fail_five_e_restart: true,
            ..Default::default()
        };

        let warnings =
            execute_switch_workflow(&mut executor, false, true).expect("Steam switch succeeds");

        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("5E 未能启动或重启"));
        assert_eq!(
            executor.operations.last(),
            Some(&SwitchOperation::RestartFiveE)
        );
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum SwitchOperation {
        ShutdownSteam,
        PrepareCs2Config,
        SwitchSteamAccount,
        RecordSwitch,
        RestartFiveE,
    }

    #[derive(Default)]
    struct RecordingSwitchWorkflowExecutor {
        operations: Vec<SwitchOperation>,
        fail_five_e_restart: bool,
    }

    impl SwitchWorkflowExecutor for RecordingSwitchWorkflowExecutor {
        fn shutdown_steam(&mut self) -> AppResult<()> {
            self.operations.push(SwitchOperation::ShutdownSteam);
            Ok(())
        }

        fn prepare_cs2_config(&mut self) -> AppResult<()> {
            self.operations.push(SwitchOperation::PrepareCs2Config);
            Ok(())
        }

        fn switch_steam_account(&mut self) -> AppResult<()> {
            self.operations.push(SwitchOperation::SwitchSteamAccount);
            Ok(())
        }

        fn record_switch(&mut self) -> AppResult<()> {
            self.operations.push(SwitchOperation::RecordSwitch);
            Ok(())
        }

        fn restart_five_e(&mut self) -> AppResult<()> {
            self.operations.push(SwitchOperation::RestartFiveE);
            if self.fail_five_e_restart {
                Err(AppError::new("PLATFORM_LAUNCH_FAILED", "无法启动平台程序"))
            } else {
                Ok(())
            }
        }
    }
}
