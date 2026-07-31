//! Official software discovery and verified installer download workflows.
use crate::error::{AppError, AppResult};
use crate::models::DownloadProgress;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::blocking::Client;
use sha2::{Digest, Sha512};
use std::{
    collections::HashSet,
    env,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

pub const PERFECT_DOWNLOAD_PAGE: &str = "https://pvp.wanmei.com/";
pub const FIVE_E_DOWNLOAD_PAGE: &str = "https://arena.5eplay.com/download/latest";
pub const TEAMSPEAK_DOWNLOAD_PAGE: &str = "https://www.teamspeak.com/en/downloads/";
pub const STEAM_DOWNLOAD_PAGE: &str = "https://store.steampowered.com/about/";
const TEAMSPEAK_FOLDERS: &[&str] = &["TeamSpeak 3 Client", "TeamSpeak Client"];
const TEAMSPEAK_EXECUTABLES: &[&str] = &["ts3client_win64.exe", "ts3client_win32.exe"];
const REGISTRY_INSTALL_SCAN_DEPTH: usize = 3;

fn launch_official_with(
    url: &str,
    candidates: impl IntoIterator<Item = PathBuf>,
    mut launch: impl FnMut(&Path, &str) -> io::Result<()>,
    mut fallback: impl FnMut(&str) -> io::Result<()>,
) -> io::Result<()> {
    for candidate in candidates {
        if launch(&candidate, url).is_ok() {
            return Ok(());
        }
    }
    fallback(url)
}

fn edge_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        if let Some(root) = env::var_os(variable) {
            candidates.push(
                PathBuf::from(root)
                    .join("Microsoft")
                    .join("Edge")
                    .join("Application")
                    .join("msedge.exe"),
            );
        }
    }
    candidates.push(PathBuf::from("msedge.exe"));
    candidates
}

pub fn open_official(code: &str) -> AppResult<()> {
    let url = match code {
        "steam" => STEAM_DOWNLOAD_PAGE,
        "5e" => FIVE_E_DOWNLOAD_PAGE,
        "perfectworld" => PERFECT_DOWNLOAD_PAGE,
        "teamspeak3" => TEAMSPEAK_DOWNLOAD_PAGE,
        _ => return Err(AppError::new("SOFTWARE_NOT_SUPPORTED", "不支持该软件官网")),
    };
    launch_official_with(
        url,
        edge_candidates(),
        |program, address| {
            Command::new(program)
                .arg("--new-window")
                .arg(address)
                .spawn()
                .map(|_| ())
        },
        |address| {
            Command::new("explorer.exe")
                .arg(address)
                .spawn()
                .map(|_| ())
        },
    )
    .map_err(|error| {
        AppError::new("BROWSER_OPEN_FAILED", "无法打开浏览器")
            .detail(format!("Edge 与系统默认浏览器均启动失败: {error}"))
    })
}

struct DownloadSpec {
    url: String,
    file_name: String,
    expected_size: Option<u64>,
    expected_sha512: Option<String>,
}

fn client() -> AppResult<Client> {
    Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60 * 60))
        .user_agent(concat!("SteamAccountManager/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| {
            AppError::new("DOWNLOAD_CLIENT_FAILED", "无法初始化下载器").detail(error.to_string())
        })
}

fn metadata_value(input: &str, key: &str) -> Option<String> {
    input.lines().find_map(|line| {
        line.split_once(':').and_then(|(candidate, value)| {
            candidate
                .trim()
                .eq_ignore_ascii_case(key)
                .then(|| value.trim().trim_matches('"').to_string())
        })
    })
}

fn perfect_spec(client: &Client) -> AppResult<DownloadSpec> {
    let metadata = client
        .get("https://client.wmpvp.com/download/latest.yml")
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| {
            AppError::new("DOWNLOAD_METADATA_FAILED", "无法读取完美世界官方下载信息")
                .detail(error.to_string())
        })?
        .text()
        .map_err(|error| {
            AppError::new("DOWNLOAD_METADATA_FAILED", "完美世界下载信息格式无效")
                .detail(error.to_string())
        })?;
    let file_name = metadata_value(&metadata, "path")
        .ok_or_else(|| AppError::new("DOWNLOAD_METADATA_INVALID", "官方元数据缺少安装包路径"))?;
    if !file_name.starts_with("perfectworldarena_win32_v")
        || !file_name.ends_with(".exe")
        || file_name.contains(['/', '\\'])
    {
        return Err(AppError::new(
            "DOWNLOAD_METADATA_INVALID",
            "完美世界官方安装包路径未通过安全检查",
        ));
    }
    Ok(DownloadSpec {
        url: format!("https://client.wmpvp.com/download/{file_name}"),
        file_name,
        expected_size: metadata_value(&metadata, "size").and_then(|value| value.parse().ok()),
        expected_sha512: metadata_value(&metadata, "sha512"),
    })
}

fn teamspeak_spec(client: &Client) -> AppResult<DownloadSpec> {
    let html = client
        .get(TEAMSPEAK_DOWNLOAD_PAGE)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| {
            AppError::new("DOWNLOAD_METADATA_FAILED", "无法读取 TeamSpeak 官方下载页")
                .detail(error.to_string())
        })?
        .text()
        .map_err(|error| {
            AppError::new("DOWNLOAD_METADATA_FAILED", "TeamSpeak 下载页格式无效")
                .detail(error.to_string())
        })?;
    let package_marker = "TeamSpeak3-Client-win64-";
    let package = html
        .find(package_marker)
        .ok_or_else(|| AppError::new("DOWNLOAD_METADATA_INVALID", "未找到 TeamSpeak 3 安装包"))?;
    let marker = "https://files.teamspeak-services.com/releases/client/";
    let start = html[..package]
        .rfind(marker)
        .ok_or_else(|| AppError::new("DOWNLOAD_METADATA_INVALID", "TeamSpeak 安装包地址无效"))?;
    let tail = &html[start..];
    let end = tail
        .find(".exe")
        .map(|index| index + 4)
        .ok_or_else(|| AppError::new("DOWNLOAD_METADATA_INVALID", "TeamSpeak 安装包地址无效"))?;
    let url = tail[..end].replace("&amp;", "&");
    let file_name = url
        .rsplit('/')
        .next()
        .filter(|name| name.starts_with(package_marker))
        .ok_or_else(|| AppError::new("DOWNLOAD_METADATA_INVALID", "未找到 TeamSpeak 3 x64 安装包"))?
        .to_string();
    Ok(DownloadSpec {
        url,
        file_name,
        expected_size: None,
        expected_sha512: None,
    })
}

fn spec(code: &str, client: &Client) -> AppResult<DownloadSpec> {
    match code {
        "perfectworld" => perfect_spec(client),
        "teamspeak3" => teamspeak_spec(client),
        "5e" => Err(AppError::new(
            "DOWNLOAD_BROWSER_REQUIRED",
            "5E 官方下载需要浏览器完成安全验证",
        )
        .detail(FIVE_E_DOWNLOAD_PAGE)),
        _ => Err(AppError::new("SOFTWARE_NOT_SUPPORTED", "不支持该软件下载")),
    }
}

pub fn download_and_install(
    code: &str,
    downloads_dir: &Path,
    mut progress: impl FnMut(DownloadProgress),
) -> AppResult<()> {
    fs::create_dir_all(downloads_dir)?;
    let client = client()?;
    let spec = spec(code, &client)?;
    let mut response = client
        .get(&spec.url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| {
            AppError::new("DOWNLOAD_FAILED", "官方安装包下载失败").detail(error.to_string())
        })?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if content_type.contains("text/html") {
        return Err(AppError::new(
            "DOWNLOAD_RESPONSE_INVALID",
            "官方下载地址返回了网页，而不是安装程序",
        ));
    }
    let total = response.content_length().or(spec.expected_size);
    let partial = downloads_dir.join(format!("{}.part", spec.file_name));
    let installer = downloads_dir.join(&spec.file_name);
    let mut file = File::create(&partial)?;
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut downloaded = 0_u64;
    let mut hasher = Sha512::new();
    loop {
        let count = response.read(&mut buffer).map_err(|error| {
            AppError::new("DOWNLOAD_FAILED", "读取官方安装包时失败").detail(error.to_string())
        })?;
        if count == 0 {
            break;
        }
        file.write_all(&buffer[..count])?;
        hasher.update(&buffer[..count]);
        downloaded += count as u64;
        progress(DownloadProgress {
            code: code.to_string(),
            state: "downloading".to_string(),
            downloaded,
            total,
            message: None,
        });
    }
    file.sync_all()?;
    drop(file);
    if let Some(expected) = spec
        .expected_size
        .filter(|expected| *expected != downloaded)
    {
        let _ = fs::remove_file(&partial);
        return Err(
            AppError::new("DOWNLOAD_SIZE_MISMATCH", "安装包大小与官方元数据不一致")
                .detail(format!("expected={expected}; actual={downloaded}")),
        );
    }
    if let Some(expected) = spec.expected_sha512 {
        let expected = STANDARD.decode(expected.trim()).map_err(|_| {
            AppError::new("DOWNLOAD_METADATA_INVALID", "官方 SHA-512 校验值格式无效")
        })?;
        if expected.as_slice() != hasher.finalize().as_slice() {
            let _ = fs::remove_file(&partial);
            return Err(AppError::new(
                "DOWNLOAD_HASH_MISMATCH",
                "安装包校验值与官方元数据不一致",
            ));
        }
    }
    fs::rename(&partial, &installer)?;
    progress(DownloadProgress {
        code: code.to_string(),
        state: "installing".to_string(),
        downloaded,
        total,
        message: Some("安装程序已启动，请完成官方安装向导".to_string()),
    });
    let result = Command::new(&installer)
        .spawn()
        .and_then(|mut child| child.wait());
    let _ = fs::remove_file(&installer);
    result.map_err(|error| {
        AppError::new("INSTALLER_LAUNCH_FAILED", "无法运行官方安装程序").detail(error.to_string())
    })?;
    Ok(())
}

fn allowlisted_teamspeak_executable(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            TEAMSPEAK_EXECUTABLES
                .iter()
                .any(|executable| name.eq_ignore_ascii_case(executable))
        })
}

fn teamspeak_executables_below(directory: &Path, remaining_depth: usize) -> Vec<PathBuf> {
    let mut candidates = TEAMSPEAK_EXECUTABLES
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
            candidates.extend(teamspeak_executables_below(&path, remaining_depth - 1));
        } else if file_type.is_file() && allowlisted_teamspeak_executable(&path) {
            candidates.push(path);
        }
    }
    candidates
}

fn teamspeak_candidates_from_roots<'a>(
    roots: impl IntoIterator<Item = &'a PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for root in roots {
        for folder in TEAMSPEAK_FOLDERS {
            candidates.extend(teamspeak_executables_below(
                &root.join(folder),
                REGISTRY_INSTALL_SCAN_DEPTH,
            ));
        }
    }
    candidates
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

fn registry_teamspeak_anchor_candidates(value: &str) -> Vec<PathBuf> {
    let Some(path) = registry_path(value) else {
        return Vec::new();
    };
    if !path.is_absolute() {
        return Vec::new();
    }
    let mut candidates = Vec::new();
    if allowlisted_teamspeak_executable(&path) {
        candidates.push(path.clone());
    }
    let directory = if path.extension().is_some() {
        path.parent()
    } else {
        Some(path.as_path())
    };
    if let Some(directory) = directory {
        candidates.extend(teamspeak_executables_below(
            directory,
            REGISTRY_INSTALL_SCAN_DEPTH,
        ));
    }
    candidates
}

fn registry_teamspeak_candidates_from_fields(
    display_icon: Option<&str>,
    install_location: Option<&str>,
    uninstall_string: Option<&str>,
    quiet_uninstall_string: Option<&str>,
) -> Vec<PathBuf> {
    let uninstall_paths = [uninstall_string, quiet_uninstall_string]
        .into_iter()
        .flatten()
        .filter_map(registry_path)
        .filter_map(|path| normalized_absolute_path_key(&path))
        .collect::<HashSet<_>>();
    let mut candidates = Vec::new();
    if let Some(value) = display_icon {
        candidates.extend(registry_teamspeak_anchor_candidates(value));
    }
    if let Some(value) = install_location {
        let directory = value.trim().trim_matches('"');
        if !directory.is_empty() && Path::new(directory).is_absolute() {
            candidates.extend(teamspeak_executables_below(
                Path::new(directory),
                REGISTRY_INSTALL_SCAN_DEPTH,
            ));
        }
    }
    for value in [uninstall_string, quiet_uninstall_string]
        .into_iter()
        .flatten()
    {
        candidates.extend(registry_teamspeak_anchor_candidates(value));
    }
    candidates.retain(|candidate| {
        normalized_absolute_path_key(candidate).is_none_or(|path| !uninstall_paths.contains(&path))
    });
    candidates
}

#[cfg(windows)]
fn registry_teamspeak_candidates() -> Vec<PathBuf> {
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
            if !display_name.contains("teamspeak") {
                continue;
            }
            let display_icon = entry.get_value::<String, _>("DisplayIcon").ok();
            let install_location = entry.get_value::<String, _>("InstallLocation").ok();
            let uninstall_string = entry.get_value::<String, _>("UninstallString").ok();
            let quiet_uninstall_string = entry.get_value::<String, _>("QuietUninstallString").ok();
            candidates.extend(registry_teamspeak_candidates_from_fields(
                display_icon.as_deref(),
                install_location.as_deref(),
                uninstall_string.as_deref(),
                quiet_uninstall_string.as_deref(),
            ));
        }
    }
    candidates
}

pub fn discover_teamspeak() -> Option<PathBuf> {
    let roots = [
        "ProgramW6432",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "LOCALAPPDATA",
    ]
    .into_iter()
    .filter_map(env::var_os)
    .map(PathBuf::from)
    .collect::<Vec<_>>();
    let mut candidates = teamspeak_candidates_from_roots(roots.iter());
    #[cfg(windows)]
    {
        let fallback_roots = [
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(r"C:\Program Files (x86)"),
        ];
        candidates.extend(teamspeak_candidates_from_roots(fallback_roots.iter()));
        candidates.extend(registry_teamspeak_candidates());
    }
    candidates
        .into_iter()
        .find(|path| path.is_file() && allowlisted_teamspeak_executable(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    #[test]
    fn parses_perfect_metadata_fields() {
        let metadata = "version: 1.2.3\npath: perfectworldarena_win32_v1.2.3.exe\nsize: 123\n";
        assert_eq!(
            metadata_value(metadata, "path").as_deref(),
            Some("perfectworldarena_win32_v1.2.3.exe")
        );
        assert_eq!(metadata_value(metadata, "size").as_deref(), Some("123"));
    }

    #[test]
    fn falls_back_when_edge_cannot_be_started() {
        let attempts = std::cell::RefCell::new(Vec::new());
        let result = launch_official_with(
            "https://arena.5eplay.com/download/latest",
            [PathBuf::from("missing-edge.exe")],
            |program: &Path, _url| {
                attempts
                    .borrow_mut()
                    .push(program.to_string_lossy().into_owned());
                Err(io::Error::new(io::ErrorKind::NotFound, "missing"))
            },
            |url| {
                attempts.borrow_mut().push(format!("system:{url}"));
                Ok(())
            },
        );
        assert!(result.is_ok());
        assert!(attempts.borrow().last().unwrap().starts_with("system:"));
    }

    #[test]
    fn discovers_teamspeak_win32_and_win64_default_installations() {
        let root = tempfile::tempdir().expect("temporary program files");
        let win64 = root
            .path()
            .join("TeamSpeak 3 Client")
            .join("ts3client_win64.exe");
        let win32 = root
            .path()
            .join("TeamSpeak Client")
            .join("ts3client_win32.exe");
        fs::create_dir_all(win64.parent().expect("win64 parent")).expect("win64 directory");
        fs::create_dir_all(win32.parent().expect("win32 parent")).expect("win32 directory");
        fs::write(&win64, []).expect("fake win64 client");
        fs::write(&win32, []).expect("fake win32 client");

        let roots = [root.path().to_path_buf()];
        let candidates = teamspeak_candidates_from_roots(roots.iter());

        assert!(candidates.contains(&win64));
        assert!(candidates.contains(&win32));
    }

    #[test]
    fn resolves_custom_teamspeak_registry_installation_without_uninstaller() {
        let installation = tempfile::tempdir().expect("temporary TeamSpeak installation");
        let executable = installation
            .path()
            .join("client")
            .join("ts3client_win64.exe");
        let uninstaller = installation.path().join("Uninstall.exe");
        fs::create_dir_all(executable.parent().expect("client parent"))
            .expect("custom client directory");
        fs::write(&executable, []).expect("fake TeamSpeak client");
        fs::write(&uninstaller, []).expect("fake TeamSpeak uninstaller");
        let display_icon = format!("{},0", executable.display());
        let uninstall_command = format!("\"{}\" /S", uninstaller.display());

        let candidates = registry_teamspeak_candidates_from_fields(
            Some(&display_icon),
            Some(installation.path().to_string_lossy().as_ref()),
            Some(&uninstall_command),
            None,
        );

        assert!(candidates.contains(&executable));
        assert!(!candidates.contains(&uninstaller));
    }

    #[test]
    fn never_returns_teamspeak_uninstall_command_even_with_a_client_file_name() {
        let installation = tempfile::tempdir().expect("temporary TeamSpeak installation");
        let uninstaller = installation.path().join("ts3client_win64.exe");
        fs::write(&uninstaller, []).expect("fake allow-listed uninstaller");
        let uninstall_command = format!("\"{}\" /S", uninstaller.display());

        let candidates =
            registry_teamspeak_candidates_from_fields(None, None, Some(&uninstall_command), None);

        assert!(!candidates.contains(&uninstaller));
    }

    #[test]
    fn excludes_all_teamspeak_uninstall_paths_reintroduced_by_other_registry_fields() {
        let installation = tempfile::tempdir().expect("temporary TeamSpeak installation");
        let uninstaller = installation.path().join("ts3client_win64.exe");
        let quiet_uninstaller = installation.path().join("ts3client_win32.exe");
        fs::write(&uninstaller, []).expect("fake allow-listed uninstaller");
        fs::write(&quiet_uninstaller, []).expect("fake allow-listed quiet uninstaller");
        let display_icon = format!("{},0", uninstaller.display());
        let uninstall_command = format!("\"{}\" /S", uninstaller.display());
        let quiet_uninstall_command = format!("\"{}\" /S", quiet_uninstaller.display());

        let candidates = registry_teamspeak_candidates_from_fields(
            Some(&display_icon),
            Some(installation.path().to_string_lossy().as_ref()),
            Some(&uninstall_command),
            Some(&quiet_uninstall_command),
        );

        assert!(!candidates.contains(&uninstaller));
        assert!(!candidates.contains(&quiet_uninstaller));
    }
}
