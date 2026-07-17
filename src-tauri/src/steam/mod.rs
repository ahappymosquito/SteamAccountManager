//! Windows Steam discovery, process control, backups and safe local switching.
pub mod vdf;
use crate::error::{AppError, AppResult};
use crate::models::{CurrentStatus, LocalSteamAccount};
use chrono::Utc;
use serde_json::json;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};
use sysinfo::{ProcessesToUpdate, System};

pub fn validate_dir(path: &Path) -> AppResult<()> {
    if !path.join("steam.exe").is_file() || !path.join("config/loginusers.vdf").is_file() {
        return Err(AppError::new(
            "INVALID_STEAM_PATH",
            "所选目录缺少 steam.exe 或 config/loginusers.vdf",
        ));
    }
    Ok(())
}

#[cfg(windows)]
pub fn discover() -> AppResult<Option<PathBuf>> {
    use winreg::{enums::*, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let candidates = [
        (&hkcu, "Software\\Valve\\Steam"),
        (&hklm, "SOFTWARE\\WOW6432Node\\Valve\\Steam"),
        (&hklm, "SOFTWARE\\Valve\\Steam"),
    ];
    for (root, key) in candidates {
        if let Ok(k) = root.open_subkey(key) {
            for field in ["SteamPath", "InstallPath"] {
                if let Ok(v) = k.get_value::<String, _>(field) {
                    let p = PathBuf::from(v.replace('/', "\\"));
                    if validate_dir(&p).is_ok() {
                        return Ok(Some(p));
                    }
                }
            }
        }
    }
    Ok(None)
}
#[cfg(not(windows))]
pub fn discover() -> AppResult<Option<PathBuf>> {
    Ok(None)
}

pub fn read_accounts(dir: &Path) -> AppResult<Vec<LocalSteamAccount>> {
    validate_dir(dir)?;
    let bytes = fs::read(dir.join("config/loginusers.vdf"))?;
    let text = String::from_utf8(bytes)
        .map_err(|_| AppError::new("VDF_ENCODING", "loginusers.vdf 不是有效 UTF-8 文本"))?;
    vdf::parse_loginusers(&text)
}

pub fn sync_avatar_cache(
    dir: &Path,
    cache_root: &Path,
    accounts: &[LocalSteamAccount],
) -> AppResult<usize> {
    let source_root = dir.join("config/avatarcache");
    if !source_root.is_dir() {
        return Ok(0);
    }
    fs::create_dir_all(cache_root)?;
    let mut synced = 0;
    for account in accounts {
        if account.steam_id64.len() != 17
            || !account.steam_id64.bytes().all(|byte| byte.is_ascii_digit())
        {
            continue;
        }
        let source = source_root.join(format!("{}.png", account.steam_id64));
        let Ok(metadata) = fs::metadata(&source) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
            continue;
        }
        let Ok(bytes) = fs::read(&source) else {
            continue;
        };
        if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            continue;
        }
        let destination = cache_root.join(format!("{}.png", account.steam_id64));
        if fs::read(&destination).ok().as_deref() != Some(bytes.as_slice()) {
            fs::write(destination, bytes)?;
        }
        synced += 1;
    }
    Ok(synced)
}
pub fn is_running() -> bool {
    let mut s = System::new();
    s.refresh_processes(ProcessesToUpdate::All, true);
    s.processes()
        .values()
        .any(|p| p.name().eq_ignore_ascii_case("steam.exe"))
}

#[cfg(windows)]
fn registry_login_state() -> Option<(String, u32)> {
    use winreg::{enums::*, RegKey};
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Valve\\Steam")
        .ok()?;
    Some((
        key.get_value("AutoLoginUser").ok()?,
        key.get_value("RememberPassword").ok()?,
    ))
}
#[cfg(not(windows))]
fn registry_login_state() -> Option<(String, u32)> {
    None
}

fn registry_auto_login() -> Option<String> {
    registry_login_state().map(|(account_name, _)| account_name)
}
pub fn status(dir: Option<&Path>) -> CurrentStatus {
    let running = is_running();
    let account_name = registry_auto_login();
    let mut steam_id64 = None;
    if let (Some(d), Some(name)) = (dir, account_name.as_deref()) {
        if let Ok(accounts) = read_accounts(d) {
            steam_id64 = accounts
                .into_iter()
                .find(|a| a.account_name.as_deref() == Some(name))
                .map(|a| a.steam_id64);
        }
    }
    let kind = if !running {
        "steam_not_running"
    } else if account_name.is_some() && steam_id64.is_some() {
        "locally_confirmed"
    } else if account_name.is_some() {
        "inferred"
    } else {
        "unknown"
    }
    .into();
    CurrentStatus {
        kind,
        account_name,
        steam_id64,
        steam_running: running,
    }
}

fn replace_with_fallback(
    primary: impl FnOnce() -> Result<(), i32>,
    fallback: impl FnOnce() -> Result<(), i32>,
) -> Result<(), (i32, i32)> {
    match primary() {
        Ok(()) => Ok(()),
        Err(primary_code) => fallback().map_err(|fallback_code| (primary_code, fallback_code)),
    }
}

#[cfg(windows)]
fn ensure_config_not_busy(path: &Path) -> AppResult<()> {
    use std::os::windows::fs::OpenOptionsExt;
    match OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .open(path)
    {
        Ok(file) => {
            drop(file);
            Ok(())
        }
        Err(error) if matches!(error.raw_os_error(), Some(32 | 33)) => Err(AppError::new(
            "STEAM_CONFIG_BUSY",
            "Steam 配置文件仍被占用，请等待 Steam 完全退出后重试",
        )
        .detail(format!(
            "phase=exclusive_open; win32={}",
            error.raw_os_error().unwrap_or_default()
        ))),
        Err(error) => Err(AppError::new(
            "ATOMIC_REPLACE_FAILED",
            "无法以写入方式打开 Steam 配置文件",
        )
        .detail(format!(
            "phase=exclusive_open; win32={}",
            error.raw_os_error().unwrap_or_default()
        ))),
    }
}

#[cfg(not(windows))]
fn ensure_config_not_busy(_: &Path) -> AppResult<()> {
    Ok(())
}

#[cfg(windows)]
fn replace_windows(path: &Path, temp: &Path) -> Result<(), (i32, i32)> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        REPLACE_FILE_FLAGS,
    };
    let destination: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let replacement: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    replace_with_fallback(
        || unsafe {
            ReplaceFileW(
                PCWSTR(destination.as_ptr()),
                PCWSTR(replacement.as_ptr()),
                PCWSTR::null(),
                REPLACE_FILE_FLAGS(0),
                None,
                None,
            )
            .map_err(|error| error.code().0)
        },
        || unsafe {
            MoveFileExW(
                PCWSTR(replacement.as_ptr()),
                PCWSTR(destination.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
            .map_err(|error| error.code().0)
        },
    )
}

fn atomic_write_with(
    path: &Path,
    content: &str,
    replace: impl FnOnce(&Path, &Path) -> Result<(), (i32, i32)>,
) -> AppResult<()> {
    ensure_config_not_busy(path)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("loginusers.vdf");
    let temp = path.with_file_name(format!("{file_name}.sam-{}.tmp", uuid::Uuid::new_v4()));
    let permissions = fs::metadata(path)?.permissions();
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::set_permissions(&temp, permissions)?;
        replace(path, &temp).map_err(|(primary, fallback)| {
            AppError::new("ATOMIC_REPLACE_FAILED", "无法原子替换 loginusers.vdf").detail(
                format!(
                    "phase=atomic_replace; replace_hresult={primary:#010x}; move_hresult={fallback:#010x}"
                ),
            )
        })?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn atomic_write(path: &Path, content: &str) -> AppResult<()> {
    #[cfg(windows)]
    {
        atomic_write_with(path, content, replace_windows)
    }
    #[cfg(not(windows))]
    {
        atomic_write_with(path, content, |destination, replacement| {
            fs::rename(replacement, destination).map_err(|error| {
                let code = error.raw_os_error().unwrap_or_default();
                (code, code)
            })
        })
    }
}

fn backup(dir: &Path, backup_root: &Path, target: &str) -> AppResult<PathBuf> {
    let name = Utc::now().format("%Y%m%dT%H%M%S%.3fZ").to_string();
    let folder = backup_root.join(name);
    fs::create_dir_all(&folder)?;
    fs::copy(
        dir.join("config/loginusers.vdf"),
        folder.join("loginusers.vdf"),
    )?;
    fs::write(folder.join("metadata.json"),serde_json::to_vec_pretty(&json!({"createdAt":Utc::now().to_rfc3339(),"targetSteamId64":target,"autoLoginUser":registry_auto_login()})).map_err(|_|AppError::new("BACKUP_FAILED","无法创建备份元数据"))?)?;
    let mut dirs: Vec<_> = fs::read_dir(backup_root)?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .collect();
    dirs.sort_by_key(|e| e.file_name());
    while dirs.len() > 10 {
        if let Some(old) = dirs.first() {
            fs::remove_dir_all(old.path())?;
        }
        dirs.remove(0);
    }
    Ok(folder)
}

#[cfg(windows)]
fn set_registry(account: &str) -> AppResult<()> {
    use winreg::{enums::*, RegKey};
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey("Software\\Valve\\Steam")
        .map_err(|_| AppError::new("REGISTRY_WRITE_FAILED", "无法写入 Steam 注册表设置"))?;
    key.set_value("AutoLoginUser", &account)
        .map_err(|_| AppError::new("REGISTRY_WRITE_FAILED", "无法设置 Steam 自动登录账号"))?;
    key.set_value("RememberPassword", &1u32)
        .map_err(|_| AppError::new("REGISTRY_WRITE_FAILED", "无法设置 Steam 记住密码状态"))?;
    Ok(())
}

fn validate_auto_login_state(
    accounts: &[LocalSteamAccount],
    registry: Option<(&str, u32)>,
    target: &str,
    account_name: &str,
) -> AppResult<()> {
    let target_account = accounts.iter().find(|account| account.steam_id64 == target);
    let target_ready = target_account.is_some_and(|account| {
        account.remember_password && account.allow_auto_login && account.most_recent
    });
    let only_target_is_recent = accounts
        .iter()
        .all(|account| account.steam_id64 == target || !account.most_recent);
    let registry_ready = registry.is_some_and(|(name, remember_password)| {
        name.eq_ignore_ascii_case(account_name) && remember_password == 1
    });
    if target_ready && only_target_is_recent && registry_ready {
        Ok(())
    } else {
        Err(AppError::new(
            "STEAM_AUTOLOGIN_NOT_PERSISTED",
            "Steam 未保留目标账号的自动登录状态，请在 Steam 官方客户端重新登录并勾选“记住我”",
        ))
    }
}

fn verify_auto_login_state(dir: &Path, target: &str, account_name: &str) -> AppResult<()> {
    let accounts = read_accounts(dir)?;
    let registry = registry_login_state();
    validate_auto_login_state(
        &accounts,
        registry
            .as_ref()
            .map(|(name, remember_password)| (name.as_str(), *remember_password)),
        target,
        account_name,
    )
}

fn wait_for_stable_auto_login(
    dir: &Path,
    target: &str,
    account_name: &str,
    startup_timeout: u64,
) -> AppResult<()> {
    let started = Instant::now();
    let mut saw_running = false;
    let mut valid_since = None;
    let mut last_validation_error = None;
    loop {
        if is_running() {
            saw_running = true;
            match verify_auto_login_state(dir, target, account_name) {
                Ok(()) => {
                    let valid_at = valid_since.get_or_insert_with(Instant::now);
                    if valid_at.elapsed() >= Duration::from_secs(2) {
                        return Ok(());
                    }
                }
                Err(error) => {
                    valid_since = None;
                    last_validation_error = Some(error);
                }
            }
        } else {
            valid_since = None;
        }
        if started.elapsed() > Duration::from_secs(startup_timeout) {
            if saw_running {
                return Err(last_validation_error.unwrap_or_else(|| {
                    AppError::new(
                        "STEAM_AUTOLOGIN_NOT_PERSISTED",
                        "Steam 未保留目标账号的自动登录状态，请在 Steam 官方客户端重新登录并勾选“记住我”",
                    )
                }));
            }
            return Err(AppError::new(
                "STEAM_START_TIMEOUT",
                "Steam 未在限定时间内稳定启动，无法确认自动登录状态",
            ));
        }
        thread::sleep(Duration::from_millis(500));
    }
}

fn switchable_account<'a>(
    accounts: &'a [LocalSteamAccount],
    target: &str,
) -> AppResult<&'a LocalSteamAccount> {
    accounts
        .iter()
        .find(|account| account.steam_id64 == target && account.remember_password)
        .ok_or_else(|| {
            AppError::new(
                "ACCOUNT_NOT_SWITCHABLE",
                "目标账号不存在或未被 Steam 记住，请先在 Steam 官方客户端登录并勾选“记住我”",
            )
        })
}
#[cfg(not(windows))]
fn set_registry(_: &str) -> AppResult<()> {
    Err(AppError::new("WINDOWS_ONLY", "账号切换仅支持 Windows"))
}

pub fn switch(
    dir: &Path,
    backup_root: &Path,
    target: &str,
    shutdown_timeout: u64,
    startup_timeout: u64,
) -> AppResult<()> {
    validate_dir(dir)?;
    let path = dir.join("config/loginusers.vdf");
    let original = fs::read_to_string(&path)?;
    let accounts = vdf::parse_loginusers(&original)?;
    let account = switchable_account(&accounts, target)?;
    let name = account
        .account_name
        .clone()
        .ok_or_else(|| AppError::new("ACCOUNT_NAME_MISSING", "目标账号缺少 Steam 登录名"))?;
    if is_running() {
        Command::new(dir.join("steam.exe"))
            .arg("-shutdown")
            .spawn()
            .map_err(|_| AppError::new("STEAM_SHUTDOWN_FAILED", "无法请求 Steam 正常退出"))?;
        let start = Instant::now();
        while is_running() {
            if start.elapsed() > Duration::from_secs(shutdown_timeout) {
                return Err(
                    AppError::new("STEAM_SHUTDOWN_TIMEOUT", "Steam 未在限定时间内退出")
                        .detail("wait_or_force"),
                );
            }
            thread::sleep(Duration::from_millis(500));
        }
    }
    let folder = backup(dir, backup_root, target)?;
    let patched = vdf::patch_auto_login(&original, target)?;
    if let Err(err) = (|| {
        atomic_write(&path, &patched)?;
        set_registry(&name)?;
        verify_auto_login_state(dir, target, &name)?;
        Ok::<(), AppError>(())
    })() {
        let _ = fs::copy(folder.join("loginusers.vdf"), &path);
        return Err(err);
    }
    Command::new(dir.join("steam.exe"))
        .spawn()
        .map_err(|_| AppError::new("STEAM_START_FAILED", "设置已完成，但无法启动 Steam"))?;
    wait_for_stable_auto_login(dir, target, &name, startup_timeout)?;
    Ok(())
}

pub fn restore_latest(dir: &Path, backup_root: &Path) -> AppResult<()> {
    let mut dirs: Vec<_> = fs::read_dir(backup_root)?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .collect();
    dirs.sort_by_key(|e| e.file_name());
    let latest = dirs
        .last()
        .ok_or_else(|| AppError::new("BACKUP_NOT_FOUND", "没有可恢复的备份"))?;
    fs::copy(
        latest.path().join("loginusers.vdf"),
        dir.join("config/loginusers.vdf"),
    )?;
    Ok(())
}

#[cfg(test)]
mod atomic_write_tests {
    use super::*;
    use std::cell::Cell;

    fn account(
        steam_id64: &str,
        remember_password: bool,
        allow_auto_login: bool,
        most_recent: bool,
    ) -> LocalSteamAccount {
        LocalSteamAccount {
            steam_id64: steam_id64.into(),
            account_name: Some("alpha".into()),
            persona_name: None,
            remember_password,
            allow_auto_login,
            most_recent,
            timestamp: None,
        }
    }

    #[test]
    fn copies_local_png_avatar_and_updates_changed_content() {
        let steam = tempfile::tempdir().expect("steam directory");
        let cache = tempfile::tempdir().expect("avatar cache");
        let source = steam.path().join("config/avatarcache");
        fs::create_dir_all(&source).expect("create avatar source");
        let steam_id = "76561198000000002";
        let first = b"\x89PNG\r\n\x1a\nfirst";
        fs::write(source.join(format!("{steam_id}.png")), first).expect("write avatar");

        assert_eq!(
            sync_avatar_cache(
                steam.path(),
                cache.path(),
                &[account(steam_id, true, true, true)]
            )
            .expect("sync"),
            1
        );
        assert_eq!(
            fs::read(cache.path().join(format!("{steam_id}.png"))).expect("cached avatar"),
            first
        );

        let second = b"\x89PNG\r\n\x1a\nsecond";
        fs::write(source.join(format!("{steam_id}.png")), second).expect("update avatar");
        sync_avatar_cache(
            steam.path(),
            cache.path(),
            &[account(steam_id, true, true, true)],
        )
        .expect("resync");
        assert_eq!(
            fs::read(cache.path().join(format!("{steam_id}.png"))).expect("updated cache"),
            second
        );
    }

    #[test]
    fn missing_or_unsafe_avatar_never_erases_last_cache() {
        let steam = tempfile::tempdir().expect("steam directory");
        let cache = tempfile::tempdir().expect("avatar cache");
        fs::create_dir_all(steam.path().join("config/avatarcache")).expect("source");
        let steam_id = "76561198000000002";
        let cached = cache.path().join(format!("{steam_id}.png"));
        fs::write(&cached, b"\x89PNG\r\n\x1a\nremembered").expect("last avatar");

        assert_eq!(
            sync_avatar_cache(
                steam.path(),
                cache.path(),
                &[account(steam_id, true, true, true)]
            )
            .expect("missing source"),
            0
        );
        assert!(cached.exists());
        fs::write(
            steam
                .path()
                .join(format!("config/avatarcache/{steam_id}.png")),
            b"not a png",
        )
        .expect("invalid source");
        assert_eq!(
            sync_avatar_cache(
                steam.path(),
                cache.path(),
                &[
                    account(steam_id, true, true, true),
                    account("../outside", true, true, true)
                ]
            )
            .expect("unsafe source"),
            0
        );
        assert_eq!(
            fs::read(cached).expect("preserved avatar"),
            b"\x89PNG\r\n\x1a\nremembered"
        );
    }

    #[test]
    fn accepts_persisted_auto_login_state() {
        let accounts = vec![
            account("76561198000000001", false, true, false),
            account("76561198000000002", true, true, true),
        ];
        assert!(validate_auto_login_state(
            &accounts,
            Some(("alpha", 1)),
            "76561198000000002",
            "ALPHA",
        )
        .is_ok());
    }

    #[test]
    fn rejects_state_rewritten_by_steam() {
        let accounts = vec![account("76561198000000002", true, false, true)];
        let error =
            validate_auto_login_state(&accounts, Some(("alpha", 1)), "76561198000000002", "alpha")
                .expect_err("disabled auto login must fail validation");
        assert_eq!(error.code, "STEAM_AUTOLOGIN_NOT_PERSISTED");
    }

    #[test]
    fn rejects_unremembered_or_ambiguous_recent_accounts() {
        let unremembered = vec![account("76561198000000002", false, true, true)];
        assert!(validate_auto_login_state(
            &unremembered,
            Some(("alpha", 1)),
            "76561198000000002",
            "alpha",
        )
        .is_err());
        let ambiguous = vec![
            account("76561198000000001", true, true, true),
            account("76561198000000002", true, true, true),
        ];
        assert!(validate_auto_login_state(
            &ambiguous,
            Some(("alpha", 1)),
            "76561198000000002",
            "alpha",
        )
        .is_err());
    }

    #[test]
    fn rejects_account_without_remembered_credentials_before_switching() {
        let accounts = vec![account("76561198000000002", false, false, false)];
        let error = switchable_account(&accounts, "76561198000000002")
            .expect_err("unremembered account must not be switchable");
        assert_eq!(error.code, "ACCOUNT_NOT_SWITCHABLE");
    }

    fn temporary_files(directory: &Path) -> Vec<PathBuf> {
        fs::read_dir(directory)
            .expect("read test directory")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.contains(".sam-") && name.ends_with(".tmp"))
            })
            .collect()
    }

    #[test]
    fn atomically_replaces_closed_file_and_cleans_temporary_file() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("loginusers.vdf");
        fs::write(&path, "old").expect("write original");

        atomic_write(&path, "new").expect("atomic replacement");

        assert_eq!(fs::read_to_string(&path).expect("read result"), "new");
        assert!(temporary_files(directory.path()).is_empty());
    }

    #[test]
    fn fallback_runs_only_after_primary_failure() {
        let fallback_called = Cell::new(false);
        let result = replace_with_fallback(
            || Err(5),
            || {
                fallback_called.set(true);
                Ok(())
            },
        );
        assert_eq!(result, Ok(()));
        assert!(fallback_called.get());
    }

    #[test]
    fn double_failure_preserves_original_and_reports_codes() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("loginusers.vdf");
        fs::write(&path, "original").expect("write original");

        let error = atomic_write_with(&path, "replacement", |_, _| Err((5, 32)))
            .expect_err("replacement must fail");

        assert_eq!(error.code, "ATOMIC_REPLACE_FAILED");
        assert!(error.details.as_deref().is_some_and(|details| {
            details.contains("replace_hresult=0x00000005")
                && details.contains("move_hresult=0x00000020")
        }));
        assert_eq!(
            fs::read_to_string(&path).expect("read original"),
            "original"
        );
        assert!(temporary_files(directory.path()).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn locked_destination_is_reported_as_busy_without_modification() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("loginusers.vdf");
        fs::write(&path, "original").expect("write original");
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&path)
            .expect("exclusive lock");

        let error = atomic_write(&path, "replacement").expect_err("file must be busy");

        assert_eq!(error.code, "STEAM_CONFIG_BUSY");
        drop(lock);
        assert_eq!(
            fs::read_to_string(&path).expect("read original"),
            "original"
        );
        assert!(temporary_files(directory.path()).is_empty());
    }
}
