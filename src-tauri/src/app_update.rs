//! CDN-hosted application updates: check latest.json, download the installer, then restart.
use crate::cdn::APP_LATEST_URL;
use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager};
use uuid::Uuid;

pub struct AppUpdateState {
    pending: Mutex<Option<CdnLatest>>,
    installing: AtomicBool,
}

impl Default for AppUpdateState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(None),
            installing: AtomicBool::new(false),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CdnLatest {
    version: String,
    notes: Option<String>,
    setup_url: String,
    sha256: Option<String>,
    size: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    version: String,
    date: Option<String>,
    notes: Option<String>,
    portable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    state: &'static str,
    downloaded: u64,
    total: Option<u64>,
    message: Option<String>,
}

fn updater_error(code: &str, message: &str, error: impl std::fmt::Display) -> AppError {
    AppError::new(code, message).detail(error.to_string())
}

fn send_progress(
    channel: &Channel<UpdateProgress>,
    state: &'static str,
    downloaded: u64,
    total: Option<u64>,
    message: Option<String>,
) {
    let _ = channel.send(UpdateProgress {
        state,
        downloaded,
        total,
        message,
    });
}

fn normalized_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn executable_is_installed(current_exe: &Path, install_location: Option<&Path>) -> bool {
    let Some(install_location) = install_location else {
        return false;
    };
    let expected = install_location.join("steam-account-manager.exe");
    normalized_path(current_exe) == normalized_path(&expected)
}

#[cfg(windows)]
fn installed_location() -> Option<PathBuf> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let key = current_user
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Steam Account Manager")
        .ok()?;
    let value: String = key.get_value("InstallLocation").ok()?;
    let trimmed = value.trim().trim_matches('"');
    (!trimmed.is_empty()).then(|| PathBuf::from(trimmed))
}

#[cfg(not(windows))]
fn installed_location() -> Option<PathBuf> {
    None
}

fn running_portable() -> bool {
    let current_exe = std::env::current_exe().ok();
    !current_exe
        .as_deref()
        .is_some_and(|path| executable_is_installed(path, installed_location().as_deref()))
}

fn parse_version(value: &str) -> [u64; 3] {
    let mut parts = value.trim().trim_start_matches('v').split('.');
    let mut out = [0; 3];
    for slot in &mut out {
        *slot = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    }
    out
}

fn version_is_newer(current: &str, candidate: &str) -> bool {
    parse_version(candidate) > parse_version(current)
}

struct InstallGuard<'a>(&'a AtomicBool);

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn http_client() -> AppResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60 * 30))
        .user_agent(concat!("SteamAccountManager/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| updater_error("UPDATE_CONFIG_FAILED", "无法初始化更新下载器", error))
}

#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    state: tauri::State<'_, AppUpdateState>,
) -> AppResult<Option<UpdateInfo>> {
    if state.installing.load(Ordering::Acquire) {
        return Err(AppError::new(
            "UPDATE_IN_PROGRESS",
            "应用正在更新，请等待安装完成",
        ));
    }

    let current_version = app.package_info().version.to_string();
    let latest = tauri::async_runtime::spawn_blocking(|| {
        http_client()?
            .get(APP_LATEST_URL)
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| updater_error("UPDATE_CHECK_FAILED", "无法检查应用更新", error))?
            .json::<CdnLatest>()
            .map_err(|error| updater_error("UPDATE_CHECK_FAILED", "更新信息不完整", error))
    })
    .await
    .map_err(|error| updater_error("UPDATE_CHECK_FAILED", "无法检查应用更新", error))??;

    if !version_is_newer(&current_version, &latest.version) {
        *state.pending.lock() = None;
        return Ok(None);
    }

    let info = UpdateInfo {
        current_version,
        version: latest.version.clone(),
        date: None,
        notes: latest.notes.clone(),
        portable: running_portable(),
    };
    *state.pending.lock() = Some(latest);
    Ok(Some(info))
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    state: tauri::State<'_, AppUpdateState>,
    on_event: Channel<UpdateProgress>,
) -> AppResult<()> {
    state
        .installing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| AppError::new("UPDATE_IN_PROGRESS", "应用正在更新，请等待安装完成"))?;
    let _guard = InstallGuard(&state.installing);
    let latest = state
        .pending
        .lock()
        .take()
        .ok_or_else(|| AppError::new("UPDATE_NOT_FOUND", "没有待安装的更新，请重新检查"))?;

    let total = latest.size;
    send_progress(&on_event, "downloading", 0, total, None);
    let installer_path = app
        .path()
        .temp_dir()
        .map_err(|error| updater_error("UPDATE_TEMP_FAILED", "无法创建更新临时目录", error))?
        .join(format!(
            "steam-account-manager-update-{}.exe",
            Uuid::new_v4()
        ));
    let progress = on_event.clone();
    let destination = installer_path.clone();
    let downloaded = tauri::async_runtime::spawn_blocking(move || {
        download_installer(&latest, &destination, &progress)
    })
    .await
    .map_err(|error| updater_error("UPDATE_DOWNLOAD_FAILED", "更新包下载失败", error))??;

    send_progress(&on_event, "installing", downloaded, total, None);
    let waiting_path = installer_path.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        Command::new(&waiting_path).args(["/P", "/R"]).status()
    })
    .await
    .map_err(|error| updater_error("UPDATE_INSTALL_FAILED", "更新安装程序异常退出", error))?;
    let _ = fs::remove_file(&installer_path);
    let status = status
        .map_err(|error| updater_error("UPDATE_INSTALL_FAILED", "无法启动更新安装程序", error))?;
    if !status.success() {
        send_progress(
            &on_event,
            "error",
            downloaded,
            total,
            Some(format!(
                "更新安装程序退出码：{}",
                status.code().unwrap_or(-1)
            )),
        );
        return Err(AppError::new(
            "UPDATE_INSTALL_FAILED",
            format!("更新安装程序退出码：{}", status.code().unwrap_or(-1)),
        ));
    }

    send_progress(&on_event, "completed", downloaded, total, None);
    app.exit(0);
    Ok(())
}

fn download_installer(
    latest: &CdnLatest,
    destination: &Path,
    on_event: &Channel<UpdateProgress>,
) -> AppResult<u64> {
    let mut response = http_client()?
        .get(&latest.setup_url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| updater_error("UPDATE_DOWNLOAD_FAILED", "更新包下载失败", error))?;
    let total = response.content_length().or(latest.size);
    let mut file = fs::File::create(destination)
        .map_err(|error| updater_error("UPDATE_TEMP_FAILED", "无法写入更新安装程序", error))?;
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut hasher = Sha256::new();
    let downloaded = Arc::new(AtomicU64::new(0));
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|error| updater_error("UPDATE_DOWNLOAD_FAILED", "读取更新包时失败", error))?;
        if count == 0 {
            break;
        }
        file.write_all(&buffer[..count])
            .map_err(|error| updater_error("UPDATE_TEMP_FAILED", "无法写入更新安装程序", error))?;
        hasher.update(&buffer[..count]);
        let current = downloaded.fetch_add(count as u64, Ordering::AcqRel) + count as u64;
        send_progress(on_event, "downloading", current, total, None);
    }
    let downloaded = downloaded.load(Ordering::Acquire);
    if let Some(expected) = latest.size.filter(|value| *value != downloaded) {
        return Err(AppError::new(
            "UPDATE_DOWNLOAD_FAILED",
            format!("更新包大小不符：期望 {expected}，实际 {downloaded}"),
        ));
    }
    if let Some(expected) = latest.sha256.as_deref() {
        let actual = format!("{:x}", hasher.finalize());
        if !expected.eq_ignore_ascii_case(&actual) {
            return Err(AppError::new(
                "UPDATE_DOWNLOAD_FAILED",
                "更新包校验失败，已中止安装",
            ));
        }
    }
    Ok(downloaded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_executable_inside_registered_install_directory() {
        let location = Path::new(r"C:\Users\tester\AppData\Local\Steam Account Manager");
        assert!(executable_is_installed(
            &location.join("steam-account-manager.exe"),
            Some(location)
        ));
    }

    #[test]
    fn treats_renamed_or_external_executable_as_portable() {
        let location = Path::new(r"C:\Users\tester\AppData\Local\Steam Account Manager");
        assert!(!executable_is_installed(
            Path::new(r"D:\Tools\Steam Account Manager.exe"),
            Some(location)
        ));
        assert!(!executable_is_installed(
            &location.join("Steam Account Manager.exe"),
            Some(location)
        ));
        assert!(!executable_is_installed(
            &location.join("steam-account-manager.exe"),
            None
        ));
    }

    #[test]
    fn treats_higher_semver_as_newer() {
        assert!(version_is_newer("0.11.7", "0.11.8"));
        assert!(!version_is_newer("0.11.8", "0.11.8"));
        assert!(!version_is_newer("0.12.0", "0.11.9"));
    }
}
