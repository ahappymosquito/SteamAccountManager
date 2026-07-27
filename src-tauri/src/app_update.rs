//! Signed GitHub Release update checks and Windows installation orchestration.
use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use uuid::Uuid;

const WINDOWS_UPDATE_TARGET: &str = "windows-x86_64-nsis";

pub struct AppUpdateState {
    pending: Mutex<Option<Update>>,
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

struct InstallGuard<'a>(&'a AtomicBool);

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
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

    let update = app
        .updater_builder()
        .target(WINDOWS_UPDATE_TARGET)
        .build()
        .map_err(|error| updater_error("UPDATE_CONFIG_FAILED", "更新服务配置无效", error))?
        .check()
        .await
        .map_err(|error| updater_error("UPDATE_CHECK_FAILED", "无法检查应用更新", error))?;

    let info = update.as_ref().map(|update| UpdateInfo {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.map(|date| date.to_string()),
        notes: update.body.clone(),
        portable: running_portable(),
    });
    *state.pending.lock() = update;
    Ok(info)
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
    let update = state
        .pending
        .lock()
        .take()
        .ok_or_else(|| AppError::new("UPDATE_NOT_FOUND", "没有待安装的更新，请重新检查"))?;

    send_progress(&on_event, "downloading", 0, None, None);
    let downloaded = Arc::new(AtomicU64::new(0));
    let callback_downloaded = Arc::clone(&downloaded);
    let progress_channel = on_event.clone();
    let bytes = update
        .download(
            move |chunk_length, content_length| {
                let current = callback_downloaded
                    .fetch_add(chunk_length as u64, Ordering::AcqRel)
                    .saturating_add(chunk_length as u64);
                send_progress(
                    &progress_channel,
                    "downloading",
                    current,
                    content_length,
                    None,
                );
            },
            || {},
        )
        .await
        .map_err(|error| {
            let downloaded = downloaded.load(Ordering::Acquire);
            send_progress(
                &on_event,
                "error",
                downloaded,
                None,
                Some("更新包下载或签名校验失败".into()),
            );
            updater_error("UPDATE_DOWNLOAD_FAILED", "更新包下载或签名校验失败", error)
        })?;

    let downloaded = downloaded.load(Ordering::Acquire);
    send_progress(&on_event, "installing", downloaded, None, None);
    if running_portable() {
        install_from_portable(&app, bytes)
            .await
            .inspect_err(|error| {
                send_progress(
                    &on_event,
                    "error",
                    downloaded,
                    None,
                    Some(error.message.clone()),
                );
            })?;
        send_progress(&on_event, "completed", downloaded, None, None);
        app.exit(0);
        return Ok(());
    }

    update.install(bytes).map_err(|error| {
        send_progress(
            &on_event,
            "error",
            downloaded,
            None,
            Some("无法安装应用更新".into()),
        );
        updater_error("UPDATE_INSTALL_FAILED", "无法安装应用更新", error)
    })?;
    send_progress(&on_event, "completed", downloaded, None, None);
    app.restart();
}

async fn install_from_portable(app: &AppHandle, bytes: Vec<u8>) -> AppResult<()> {
    let installer_path = app
        .path()
        .temp_dir()
        .map_err(|error| updater_error("UPDATE_TEMP_FAILED", "无法创建更新临时目录", error))?
        .join(format!(
            "steam-account-manager-update-{}.exe",
            Uuid::new_v4()
        ));
    fs::write(&installer_path, bytes)
        .map_err(|error| updater_error("UPDATE_TEMP_FAILED", "无法写入更新安装程序", error))?;

    let waiting_path = installer_path.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        Command::new(&waiting_path).args(["/P", "/R"]).status()
    })
    .await
    .map_err(|error| updater_error("UPDATE_INSTALL_FAILED", "更新安装程序异常退出", error))?
    .map_err(|error| updater_error("UPDATE_INSTALL_FAILED", "无法启动更新安装程序", error));
    let _ = fs::remove_file(&installer_path);
    let status = status?;
    if !status.success() {
        return Err(AppError::new(
            "UPDATE_INSTALL_FAILED",
            format!("更新安装程序退出码：{}", status.code().unwrap_or(-1)),
        ));
    }
    Ok(())
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
}
