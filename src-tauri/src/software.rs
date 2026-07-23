//! Official software discovery and verified installer download workflows.
use crate::error::{AppError, AppResult};
use crate::models::DownloadProgress;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::blocking::Client;
use sha2::{Digest, Sha512};
use std::{
    env,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

pub const PERFECT_DOWNLOAD_PAGE: &str = "https://pvp.wanmei.com/";
pub const FIVE_E_DOWNLOAD_PAGE: &str = "https://arena.5eplay.com/download/latest";
pub const TEAMSPEAK_DOWNLOAD_PAGE: &str = "https://www.teamspeak.com/en/downloads/";

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
        .user_agent("SteamAccountManager/0.3.3")
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

pub fn discover_teamspeak() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(root) = env::var_os(variable) {
            for folder in ["TeamSpeak 3 Client", "TeamSpeak Client"] {
                candidates.push(
                    PathBuf::from(&root)
                        .join(folder)
                        .join("ts3client_win64.exe"),
                );
            }
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_perfect_metadata_fields() {
        let metadata = "version: 1.2.3\npath: perfectworldarena_win32_v1.2.3.exe\nsize: 123\n";
        assert_eq!(
            metadata_value(metadata, "path").as_deref(),
            Some("perfectworldarena_win32_v1.2.3.exe")
        );
        assert_eq!(metadata_value(metadata, "size").as_deref(), Some("123"));
    }
}
