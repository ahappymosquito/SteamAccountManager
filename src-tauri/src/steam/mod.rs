//! Windows Steam discovery, process control, backups and safe local switching.
pub mod vdf;
use crate::error::{AppError, AppResult};
use crate::models::{Cs2Config, CurrentStatus, LocalSteamAccount, PlatformApp};
use chrono::Utc;
use serde_json::json;
use std::{
    collections::HashSet,
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};
use sysinfo::{ProcessesToUpdate, System};

const PERFECTWORLD_EXECUTABLES: &[&str] = &[
    "完美世界竞技平台.exe",
    "PerfectWorld.exe",
    "PerfectWorldArena.exe",
    "PerfectWorldLauncher.exe",
];
const FIVE_E_EXECUTABLES: &[&str] = &[
    "5EPlay.exe",
    "5EClient.exe",
    "5EPlatform.exe",
    "5E.exe",
    "Client.exe",
];
const PERFECTWORLD_FOLDERS: &[&str] =
    &["perfectworldarena", "PerfectWorldArena", "完美世界竞技平台"];
const FIVE_E_FOLDERS: &[&str] = &["5EClient", "5E", "5EPlay", "5eplay", "5E对战平台"];
const REGISTRY_INSTALL_SCAN_DEPTH: usize = 3;

fn platform_specs() -> [(
    &'static str,
    &'static str,
    &'static [&'static str],
    &'static [&'static str],
); 2] {
    [
        (
            "perfectworld",
            "完美世界竞技平台",
            &["完美世界竞技平台", "perfectworld", "perfect world"],
            PERFECTWORLD_EXECUTABLES,
        ),
        ("5e", "5E", &["5e", "5eplay"], FIVE_E_EXECUTABLES),
    ]
}

pub fn discover_platform_apps() -> AppResult<Vec<PlatformApp>> {
    let mut apps = Vec::new();
    let mut seen = HashSet::new();
    for (platform_code, name, keywords, executables) in platform_specs() {
        let mut candidates = known_platform_candidates(platform_code, executables);
        #[cfg(windows)]
        candidates.extend(registry_platform_candidates(keywords, executables));
        for candidate in candidates {
            if !candidate.is_file()
                || candidate
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_none_or(|value| !value.eq_ignore_ascii_case("exe"))
            {
                continue;
            }
            let key = candidate.to_string_lossy().to_ascii_lowercase();
            if !seen.insert(key) {
                continue;
            }
            apps.push(PlatformApp {
                platform_code: platform_code.into(),
                name: name.into(),
                executable_path: candidate.to_string_lossy().into_owned(),
                arguments: Vec::new(),
                working_directory: candidate
                    .parent()
                    .map(|directory| directory.to_string_lossy().into_owned()),
                prelaunch_check: true,
            });
            break;
        }
    }
    Ok(apps)
}

pub fn discover_cs2_configs(steam_dir: &Path) -> AppResult<Vec<Cs2Config>> {
    const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;
    let userdata = steam_dir.join("userdata");
    if !userdata.is_dir() {
        return Ok(Vec::new());
    }
    let mut configs = Vec::new();
    for entry in fs::read_dir(userdata)?.filter_map(Result::ok) {
        let Some(account_id) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u64>().ok())
        else {
            continue;
        };
        let cfg = entry.path().join("730").join("local").join("cfg");
        if !cfg.is_dir() {
            continue;
        }
        let file_count = fs::read_dir(&cfg)?
            .filter_map(Result::ok)
            .filter(|file| {
                file.file_type().is_ok_and(|kind| kind.is_file())
                    && file
                        .path()
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .is_some_and(|extension| {
                            extension.eq_ignore_ascii_case("cfg")
                                || extension.eq_ignore_ascii_case("vcfg")
                                || extension.eq_ignore_ascii_case("txt")
                        })
            })
            .count();
        if file_count == 0 {
            continue;
        }
        configs.push(Cs2Config {
            steam_id64: (STEAM_ID64_BASE + account_id).to_string(),
            path: cfg.to_string_lossy().into_owned(),
            file_count,
        });
    }
    configs.sort_by(|left, right| left.steam_id64.cmp(&right.steam_id64));
    Ok(configs)
}

fn known_platform_candidates(platform_code: &str, executables: &[&str]) -> Vec<PathBuf> {
    let roots: Vec<PathBuf> = [
        "ProgramFiles(x86)",
        "ProgramFiles",
        "ProgramW6432",
        "LOCALAPPDATA",
        "APPDATA",
    ]
    .into_iter()
    .filter_map(env::var_os)
    .map(PathBuf::from)
    .collect();
    let mut candidates =
        known_platform_candidates_for_code_from_roots(platform_code, executables, roots.iter());
    #[cfg(windows)]
    {
        let fallback_roots = [
            PathBuf::from(r"C:\Program Files (x86)"),
            PathBuf::from(r"C:\Program Files"),
        ];
        candidates.extend(known_platform_candidates_for_code_from_roots(
            platform_code,
            executables,
            fallback_roots.iter(),
        ));
    }
    candidates
}

fn platform_install_folders(platform_code: &str) -> &'static [&'static str] {
    match platform_code {
        "perfectworld" => PERFECTWORLD_FOLDERS,
        "5e" => FIVE_E_FOLDERS,
        _ => &[],
    }
}

fn known_platform_candidates_for_code_from_roots<'a>(
    platform_code: &str,
    executables: &[&str],
    roots: impl IntoIterator<Item = &'a PathBuf>,
) -> Vec<PathBuf> {
    known_platform_candidates_from_roots(
        platform_install_folders(platform_code),
        executables,
        roots,
    )
}

fn known_platform_candidates_from_roots<'a>(
    folders: &[&str],
    executables: &[&str],
    roots: impl IntoIterator<Item = &'a PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for root in roots {
        for folder in folders {
            let installation = root.join(folder);
            candidates.extend(platform_executables_below(&installation, executables, 3));
        }
    }
    candidates
}

fn platform_executables_below(
    directory: &Path,
    executables: &[&str],
    remaining_depth: usize,
) -> Vec<PathBuf> {
    let mut candidates = executables
        .iter()
        .map(|executable| directory.join(executable))
        .collect::<Vec<_>>();
    if remaining_depth == 0 || !directory.is_dir() {
        return candidates;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return candidates;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            candidates.extend(platform_executables_below(
                &path,
                executables,
                remaining_depth - 1,
            ));
        } else if file_type.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    executables
                        .iter()
                        .any(|executable| name.eq_ignore_ascii_case(executable))
                })
        {
            candidates.push(path);
        }
    }
    candidates
}

fn allowlisted_executable(path: &Path, executables: &[&str]) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            executables
                .iter()
                .any(|executable| name.eq_ignore_ascii_case(executable))
        })
}

fn registry_path(value: &str) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let path = if let Some(quoted) = value.strip_prefix('"') {
        &quoted[..quoted.find('"')?]
    } else if let Some(index) = value
        .as_bytes()
        .windows(4)
        .position(|window| window.eq_ignore_ascii_case(b".exe"))
    {
        &value[..index + 4]
    } else {
        value.split(',').next()?.trim().trim_matches('"')
    };
    (!path.is_empty()).then(|| PathBuf::from(path))
}

fn normalized_absolute_path_key(path: &Path) -> Option<String> {
    if !path.is_absolute() {
        return None;
    }
    let normalized = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Some(
        normalized
            .to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_ascii_lowercase(),
    )
}

fn registry_anchor_candidates(value: &str, executables: &[&str]) -> Vec<PathBuf> {
    let Some(path) = registry_path(value) else {
        return Vec::new();
    };
    if !path.is_absolute() {
        return Vec::new();
    }
    let mut candidates = Vec::new();
    if allowlisted_executable(&path, executables) {
        candidates.push(path.clone());
    }
    let directory = if path.extension().is_some() {
        path.parent()
    } else {
        Some(path.as_path())
    };
    if let Some(directory) = directory {
        candidates.extend(platform_executables_below(
            directory,
            executables,
            REGISTRY_INSTALL_SCAN_DEPTH,
        ));
    }
    candidates
}

fn registry_install_location_candidates(value: &str, executables: &[&str]) -> Vec<PathBuf> {
    let value = value.trim().trim_matches('"');
    let directory = Path::new(value);
    if value.is_empty() || !directory.is_absolute() {
        return Vec::new();
    }
    platform_executables_below(directory, executables, REGISTRY_INSTALL_SCAN_DEPTH)
}

fn registry_platform_candidates_from_fields(
    display_icon: Option<&str>,
    install_location: Option<&str>,
    uninstall_string: Option<&str>,
    quiet_uninstall_string: Option<&str>,
    executables: &[&str],
) -> Vec<PathBuf> {
    let uninstall_paths = [uninstall_string, quiet_uninstall_string]
        .into_iter()
        .flatten()
        .filter_map(registry_path)
        .filter_map(|path| normalized_absolute_path_key(&path))
        .collect::<HashSet<_>>();
    let mut candidates = Vec::new();
    if let Some(value) = display_icon {
        candidates.extend(registry_anchor_candidates(value, executables));
    }
    if let Some(value) = install_location {
        candidates.extend(registry_install_location_candidates(value, executables));
    }
    for value in [uninstall_string, quiet_uninstall_string]
        .into_iter()
        .flatten()
    {
        candidates.extend(registry_anchor_candidates(value, executables));
    }
    candidates.retain(|candidate| {
        normalized_absolute_path_key(candidate).is_none_or(|path| !uninstall_paths.contains(&path))
    });
    candidates
}

#[cfg(windows)]
fn registry_platform_candidates(keywords: &[&str], executables: &[&str]) -> Vec<PathBuf> {
    use winreg::{enums::*, RegKey};

    let mut candidates = Vec::new();
    let roots = [
        (
            RegKey::predef(HKEY_CURRENT_USER),
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
    ];
    for (root, key_path) in roots {
        let Ok(uninstall) = root.open_subkey(key_path) else {
            continue;
        };
        for subkey in uninstall.enum_keys().filter_map(Result::ok) {
            let Ok(entry) = uninstall.open_subkey(&subkey) else {
                continue;
            };
            let display_name = entry
                .get_value::<String, _>("DisplayName")
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !keywords
                .iter()
                .any(|keyword| display_name.contains(keyword))
            {
                continue;
            }
            let display_icon = entry.get_value::<String, _>("DisplayIcon").ok();
            let install_location = entry.get_value::<String, _>("InstallLocation").ok();
            let uninstall_string = entry.get_value::<String, _>("UninstallString").ok();
            let quiet_uninstall_string = entry.get_value::<String, _>("QuietUninstallString").ok();
            candidates.extend(registry_platform_candidates_from_fields(
                display_icon.as_deref(),
                install_location.as_deref(),
                uninstall_string.as_deref(),
                quiet_uninstall_string.as_deref(),
                executables,
            ));
        }
    }
    candidates
}

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
        let Some(source) = find_avatar_source(&source_root, &account.steam_id64) else {
            continue;
        };
        let Ok(metadata) = fs::metadata(&source) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
            continue;
        }
        let Ok(bytes) = fs::read(&source) else {
            continue;
        };
        let Some(extension) = avatar_extension(&bytes) else {
            continue;
        };
        let destination = cache_root.join(format!("{}.{}", account.steam_id64, extension));
        if fs::read(&destination).ok().as_deref() != Some(bytes.as_slice()) {
            fs::write(destination, bytes)?;
        }
        synced += 1;
    }
    Ok(synced)
}

fn find_avatar_source(source_root: &Path, steam_id64: &str) -> Option<PathBuf> {
    for suffix in ["_full", "", "_medium", "_small"] {
        for extension in ["jpg", "jpeg", "png"] {
            let candidate = source_root.join(format!("{steam_id64}{suffix}.{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    fs::read_dir(source_root)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.is_file()
                && path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .is_some_and(|stem| {
                        stem == steam_id64
                            || stem
                                .strip_prefix(steam_id64)
                                .is_some_and(|suffix| suffix.starts_with('_'))
                    })
        })
}

fn avatar_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else {
        None
    }
}

pub fn avatar_path(cache_root: &Path, steam_id64: &str) -> Option<PathBuf> {
    ["jpg", "png", "jpeg"]
        .into_iter()
        .map(|extension| cache_root.join(format!("{steam_id64}.{extension}")))
        .find(|path| path.is_file())
}
pub fn is_running() -> bool {
    let mut s = System::new();
    s.refresh_processes(ProcessesToUpdate::All, true);
    s.processes()
        .values()
        .any(|p| p.name().eq_ignore_ascii_case("steam.exe"))
}

pub fn launch_platform(app: &PlatformApp) -> AppResult<()> {
    let path = PathBuf::from(&app.executable_path);
    if !path.is_file()
        || path
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("exe"))
    {
        return Err(AppError::new(
            "EXECUTABLE_NOT_FOUND",
            "骞冲彴绋嬪簭鏂囦欢涓嶅瓨鍦ㄦ垨涓嶆槸鏈夋晥鐨?Windows .exe",
        ));
    }
    let mut command = Command::new(&path);
    command.args(&app.arguments);
    if let Some(directory) = app
        .working_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if !Path::new(directory).is_dir() {
            return Err(AppError::new(
                "WORKING_DIRECTORY_INVALID",
                "骞冲彴宸ヤ綔鐩綍涓嶅瓨鍦ㄦ垨鏃犳晥",
            ));
        }
        command.current_dir(directory);
    }
    command
        .spawn()
        .map_err(|_| AppError::new("PLATFORM_LAUNCH_FAILED", "鏃犳硶鍚姩骞冲彴绋嬪簭"))?;
    Ok(())
}

fn normalized_windows_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn is_five_e_process(process_name: &str, process_path: Option<&Path>, app: &PlatformApp) -> bool {
    if !FIVE_E_EXECUTABLES
        .iter()
        .any(|allowed| process_name.eq_ignore_ascii_case(allowed))
    {
        return false;
    }
    let Some(process_path) = process_path else {
        return false;
    };
    let configured_path = Path::new(&app.executable_path);
    let install_root = app
        .working_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(Path::new)
        .or_else(|| configured_path.parent());
    let Some(install_root) = install_root else {
        return false;
    };
    let process_path = normalized_windows_path(process_path);
    let configured_path = normalized_windows_path(configured_path);
    if process_path == configured_path {
        return true;
    }
    let install_root = normalized_windows_path(install_root);
    process_path
        .strip_prefix(&install_root)
        .is_some_and(|suffix| suffix.starts_with('\\'))
}

fn five_e_process_ids(system: &System, app: &PlatformApp) -> Vec<sysinfo::Pid> {
    system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            is_five_e_process(&process.name().to_string_lossy(), process.exe(), app).then_some(*pid)
        })
        .collect()
}

pub fn restart_five_e(app: &PlatformApp, shutdown_timeout: Duration) -> AppResult<()> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let process_ids = five_e_process_ids(&system, app);
    for process_id in &process_ids {
        let Some(process) = system.process(*process_id) else {
            continue;
        };
        if !process.kill() {
            return Err(AppError::new(
                "PLATFORM_SHUTDOWN_FAILED",
                "无法关闭正在运行的 5E",
            ));
        }
    }
    if !process_ids.is_empty() {
        let started = Instant::now();
        loop {
            system.refresh_processes(ProcessesToUpdate::All, true);
            if five_e_process_ids(&system, app).is_empty() {
                break;
            }
            if started.elapsed() >= shutdown_timeout {
                return Err(AppError::new(
                    "PLATFORM_SHUTDOWN_TIMEOUT",
                    "等待 5E 退出超时",
                ));
            }
            thread::sleep(Duration::from_millis(200));
        }
    }
    launch_platform(app)
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
    let mut persona_name = None;
    if let (Some(d), Some(name)) = (dir, account_name.as_deref()) {
        if let Ok(accounts) = read_accounts(d) {
            if let Some(account) = accounts
                .into_iter()
                .find(|a| a.account_name.as_deref() == Some(name))
            {
                steam_id64 = Some(account.steam_id64);
                persona_name = account.persona_name;
            }
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
        persona_name,
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
    let existing_permissions = if path.exists() {
        ensure_config_not_busy(path)?;
        Some(fs::metadata(path)?.permissions())
    } else {
        None
    };
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("loginusers.vdf");
    let temp = path.with_file_name(format!("{file_name}.sam-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        if let Some(permissions) = existing_permissions {
            fs::set_permissions(&temp, permissions)?;
        }
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

pub(crate) fn atomic_write_text(path: &Path, content: &str) -> AppResult<()> {
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
    let registry = registry_login_state();
    fs::write(folder.join("metadata.json"),serde_json::to_vec_pretty(&json!({"createdAt":Utc::now().to_rfc3339(),"targetSteamId64":target,"autoLoginUser":registry.as_ref().map(|value| &value.0),"rememberPassword":registry.as_ref().map(|value| value.1)})).map_err(|_|AppError::new("BACKUP_FAILED","无法创建备份元数据"))?)?;
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

#[cfg(windows)]
fn set_registry_login_state(account: &str, remember_password: u32) -> AppResult<()> {
    use winreg::{enums::*, RegKey};
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey("Software\\Valve\\Steam")
        .map_err(|_| AppError::new("REGISTRY_WRITE_FAILED", "无法写入 Steam 注册表设置"))?;
    key.set_value("AutoLoginUser", &account)
        .and_then(|_| key.set_value("RememberPassword", &remember_password))
        .map_err(|_| AppError::new("REGISTRY_WRITE_FAILED", "无法暂停 Steam 自动登录"))
}

#[cfg(not(windows))]
fn set_registry_login_state(_: &str, _: u32) -> AppResult<()> {
    Err(AppError::new(
        "WINDOWS_ONLY",
        "Steam 登录引导仅支持 Windows",
    ))
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
    shutdown(dir, shutdown_timeout)?;
    let folder = backup(dir, backup_root, target)?;
    let patched = vdf::patch_auto_login(&original, target)?;
    if let Err(err) = (|| {
        atomic_write_text(&path, &patched)?;
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

pub fn shutdown(dir: &Path, shutdown_timeout: u64) -> AppResult<()> {
    if !is_running() {
        return Ok(());
    }
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
    Ok(())
}

pub fn begin_official_login(
    dir: &Path,
    backup_root: &Path,
    shutdown_timeout: u64,
) -> AppResult<()> {
    validate_dir(dir)?;
    if is_running() {
        Command::new(dir.join("steam.exe"))
            .arg("-shutdown")
            .spawn()
            .map_err(|_| AppError::new("STEAM_SHUTDOWN_FAILED", "无法请求 Steam 正常退出"))?;
        let started = Instant::now();
        while is_running() {
            if started.elapsed() > Duration::from_secs(shutdown_timeout) {
                return Err(AppError::new(
                    "STEAM_SHUTDOWN_TIMEOUT",
                    "Steam 未在限定时间内退出，请关闭游戏后重试",
                ));
            }
            thread::sleep(Duration::from_millis(500));
        }
    }
    let path = dir.join("config/loginusers.vdf");
    let original = fs::read_to_string(&path)?;
    let original_registry = registry_login_state();
    let folder = backup(dir, backup_root, "official-login")?;
    let patched = vdf::patch_login_prompt(&original)?;
    let result = (|| {
        atomic_write_text(&path, &patched)?;
        set_registry_login_state("", 0)?;
        Command::new(dir.join("steam.exe"))
            .spawn()
            .map_err(|_| AppError::new("STEAM_START_FAILED", "无法启动 Steam 登录窗口"))?;
        Ok::<(), AppError>(())
    })();
    if let Err(error) = result {
        let _ = fs::copy(folder.join("loginusers.vdf"), &path);
        if let Some((account, remember_password)) = original_registry {
            let _ = set_registry_login_state(&account, remember_password);
        }
        return Err(error);
    }
    Ok(())
}

fn detected_login_account(
    accounts: &[LocalSteamAccount],
    registry: Option<(&str, u32)>,
) -> Option<LocalSteamAccount> {
    let (account_name, remember_password) = registry?;
    if remember_password != 1 || account_name.trim().is_empty() {
        return None;
    }
    accounts
        .iter()
        .find(|account| {
            account.remember_password
                && account.most_recent
                && account
                    .account_name
                    .as_deref()
                    .is_some_and(|name| name.eq_ignore_ascii_case(account_name))
        })
        .cloned()
}

pub fn detect_official_login(dir: &Path) -> AppResult<Option<LocalSteamAccount>> {
    if !is_running() {
        return Ok(None);
    }
    let accounts = read_accounts(dir)?;
    let registry = registry_login_state();
    Ok(detected_login_account(
        &accounts,
        registry
            .as_ref()
            .map(|(name, remember_password)| (name.as_str(), *remember_password)),
    ))
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
    fn five_e_process_matching_requires_allowlisted_name_and_install_directory() {
        let app = PlatformApp {
            platform_code: "5e".into(),
            name: "5E".into(),
            executable_path: r"C:\Games\5EClient\5EClient.exe".into(),
            arguments: vec![],
            working_directory: Some(r"C:\Games\5EClient".into()),
            prelaunch_check: true,
        };

        assert!(is_five_e_process(
            "5EClient.exe",
            Some(Path::new(r"C:\Games\5EClient\5EClient.exe")),
            &app,
        ));
        assert!(is_five_e_process(
            "Client.exe",
            Some(Path::new(r"C:\Games\5EClient\resources\Client.exe")),
            &app,
        ));
        assert!(!is_five_e_process(
            "Client.exe",
            Some(Path::new(r"C:\Other\Client.exe")),
            &app,
        ));
        assert!(!is_five_e_process(
            "unrelated.exe",
            Some(Path::new(r"C:\Games\5EClient\unrelated.exe")),
            &app,
        ));
        assert!(!is_five_e_process("5EClient.exe", None, &app));
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
    fn copies_full_jpeg_avatar_to_the_app_cache() {
        let steam = tempfile::tempdir().expect("steam directory");
        let cache = tempfile::tempdir().expect("avatar cache");
        let source = steam.path().join("config/avatarcache");
        fs::create_dir_all(&source).expect("create avatar source");
        let steam_id = "76561198000000002";
        let jpeg = b"\xff\xd8\xffjpeg-avatar";
        fs::write(source.join(format!("{steam_id}_full.jpg")), jpeg).expect("write avatar");

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
            fs::read(cache.path().join(format!("{steam_id}.jpg"))).expect("cached avatar"),
            jpeg
        );
        assert_eq!(
            avatar_path(cache.path(), steam_id),
            Some(cache.path().join(format!("{steam_id}.jpg")))
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

    #[test]
    fn detects_only_current_remembered_official_login() {
        let accounts = vec![
            account("76561198000000001", true, false, false),
            account("76561198000000002", true, true, true),
        ];
        assert_eq!(
            detected_login_account(&accounts, Some(("alpha", 1)))
                .expect("detected account")
                .steam_id64,
            "76561198000000002"
        );
        assert!(detected_login_account(&accounts, Some(("alpha", 0))).is_none());
        let unremembered = vec![account("76561198000000002", false, true, true)];
        assert!(detected_login_account(&unremembered, Some(("alpha", 1))).is_none());
    }

    #[test]
    fn discovers_platform_executable_in_nested_install_directory() {
        let root = tempfile::tempdir().expect("temporary install root");
        let executable = root.path().join("5EPlay").join("app").join("5EClient.exe");
        fs::create_dir_all(executable.parent().expect("executable parent"))
            .expect("nested install directory");
        fs::write(&executable, []).expect("fake platform executable");

        let roots = [root.path().to_path_buf()];
        let candidates =
            known_platform_candidates_from_roots(&["5EPlay"], FIVE_E_EXECUTABLES, roots.iter());

        assert!(
            candidates.contains(&executable),
            "nested 5E installation must be detected"
        );
    }

    #[test]
    fn discovers_current_5eclient_default_installation() {
        let root = tempfile::tempdir().expect("temporary install root");
        let executable = root.path().join("5EClient").join("5EClient.exe");
        fs::create_dir_all(executable.parent().expect("executable parent"))
            .expect("5EClient installation directory");
        fs::write(&executable, []).expect("fake 5E executable");

        let roots = [root.path().to_path_buf()];
        let candidates =
            known_platform_candidates_for_code_from_roots("5e", FIVE_E_EXECUTABLES, roots.iter());

        assert!(
            candidates.contains(&executable),
            "the current 5EClient default directory must be detected"
        );
    }

    #[test]
    fn resolves_current_5e_registry_shape_without_returning_the_uninstaller() {
        let installation = tempfile::tempdir().expect("temporary 5E installation");
        let executable = installation.path().join("5EClient.exe");
        let uninstaller = installation.path().join("Uninstall 5EClient.exe");
        let icon = installation.path().join("uninstallerIcon.ico");
        fs::write(&executable, []).expect("fake 5E executable");
        fs::write(&uninstaller, []).expect("fake 5E uninstaller");
        fs::write(&icon, []).expect("fake 5E icon");
        let uninstall_command = format!("\"{}\" /allusers", uninstaller.display());
        let quiet_uninstall_command = format!("\"{}\" /allusers /S", uninstaller.display());

        let candidates = registry_platform_candidates_from_fields(
            Some(icon.to_string_lossy().as_ref()),
            None,
            Some(&uninstall_command),
            Some(&quiet_uninstall_command),
            FIVE_E_EXECUTABLES,
        );

        assert!(candidates.contains(&executable));
        assert!(!candidates.contains(&uninstaller));
        assert!(
            candidates.iter().all(|candidate| {
                candidate
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        FIVE_E_EXECUTABLES
                            .iter()
                            .any(|allowed| name.eq_ignore_ascii_case(allowed))
                    })
            }),
            "registry discovery must return only allow-listed launch executables"
        );
    }

    #[test]
    fn never_returns_the_uninstall_command_even_when_its_name_is_allowlisted() {
        let installation = tempfile::tempdir().expect("temporary 5E installation");
        let uninstaller = installation.path().join("5EClient.exe");
        fs::write(&uninstaller, []).expect("fake allow-listed uninstaller");
        let uninstall_command = format!("\"{}\" /allusers", uninstaller.display());

        let candidates = registry_platform_candidates_from_fields(
            None,
            None,
            Some(&uninstall_command),
            None,
            FIVE_E_EXECUTABLES,
        );

        assert!(!candidates.contains(&uninstaller));
    }

    #[test]
    fn excludes_all_uninstall_paths_reintroduced_by_other_registry_fields() {
        let installation = tempfile::tempdir().expect("temporary 5E installation");
        let uninstaller = installation.path().join("5EClient.exe");
        let quiet_uninstaller = installation.path().join("5EPlay.exe");
        let executable = installation.path().join("5E.exe");
        for path in [&uninstaller, &quiet_uninstaller, &executable] {
            fs::write(path, []).expect("fake 5E executable");
        }
        let display_icon = format!("{},0", uninstaller.display());
        let uninstall_command = format!("\"{}\" /allusers", uninstaller.display());
        let quiet_uninstall_command = format!("\"{}\" /allusers /S", quiet_uninstaller.display());

        let candidates = registry_platform_candidates_from_fields(
            Some(&display_icon),
            Some(installation.path().to_string_lossy().as_ref()),
            Some(&uninstall_command),
            Some(&quiet_uninstall_command),
            FIVE_E_EXECUTABLES,
        );

        assert!(candidates.contains(&executable));
        assert!(!candidates.contains(&uninstaller));
        assert!(!candidates.contains(&quiet_uninstaller));
    }

    #[test]
    fn discovers_account_scoped_cs2_configuration() {
        let steam = tempfile::tempdir().expect("temporary Steam directory");
        let cfg = steam
            .path()
            .join("userdata")
            .join("39734272")
            .join("730")
            .join("local")
            .join("cfg");
        fs::create_dir_all(&cfg).expect("CS2 cfg directory");
        fs::write(cfg.join("cs2_user_keys_0_slot0.vcfg"), b"key bindings")
            .expect("CS2 key configuration");
        fs::write(
            cfg.join("cs2_user_convars_0_slot0.vcfg"),
            b"console variables",
        )
        .expect("CS2 variable configuration");

        let configs = discover_cs2_configs(steam.path()).expect("discover CS2 configurations");

        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].steam_id64, "76561198000000000");
        assert_eq!(configs[0].path, cfg.to_string_lossy());
        assert_eq!(configs[0].file_count, 2);
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

        atomic_write_text(&path, "new").expect("atomic replacement");

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

        let error = atomic_write_text(&path, "replacement").expect_err("file must be busy");

        assert_eq!(error.code, "STEAM_CONFIG_BUSY");
        drop(lock);
        assert_eq!(
            fs::read_to_string(&path).expect("read original"),
            "original"
        );
        assert!(temporary_files(directory.path()).is_empty());
    }
}
