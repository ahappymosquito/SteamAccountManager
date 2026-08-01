//! Public Steam Community avatar and avatar-frame discovery with local caching.
use crate::error::{AppError, AppResult};
use reqwest::blocking::Client;
use reqwest::Url;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};

const MAX_MEDIA_BYTES: usize = 8 * 1024 * 1024;
const CACHE_TTL_SECONDS: i64 = 6 * 60 * 60;
const MEDIA_EXTENSIONS: [&str; 5] = ["gif", "webp", "png", "jpg", "jpeg"];

#[derive(Debug, PartialEq)]
struct ProfileMedia {
    avatar_url: Option<String>,
    frame_url: Option<String>,
}

fn image_attribute(section: &str, start: usize, attribute: &str) -> Option<String> {
    let image_start = section[start..].find("<img").map(|index| start + index)?;
    let image_end = section[image_start..]
        .find('>')
        .map(|index| image_start + index)?;
    let image = &section[image_start..=image_end];
    let marker = format!("{attribute}=\"");
    let value_start = image.find(&marker)? + marker.len();
    let value_end = image[value_start..].find('"')? + value_start;
    Some(
        image[value_start..value_end]
            .split_whitespace()
            .next()?
            .replace("&amp;", "&"),
    )
}

fn parse_profile_media(html: &str) -> Option<ProfileMedia> {
    let start = html.find("playerAvatarAutoSizeInner")?;
    let tail = &html[start..];
    let end = tail
        .find("profile_header_summary")
        .unwrap_or(tail.len().min(16 * 1024));
    let section = &tail[..end];

    let frame_url = section
        .find("profile_avatar_frame")
        .and_then(|frame_start| {
            image_attribute(section, frame_start, "srcset")
                .or_else(|| image_attribute(section, frame_start, "src"))
        });

    let mut cursor = 0;
    let mut avatar_url = None;
    while let Some(image_offset) = section[cursor..].find("<img") {
        let image_start = cursor + image_offset;
        let candidate = image_attribute(section, image_start, "srcset")
            .or_else(|| image_attribute(section, image_start, "src"));
        cursor = image_start + 4;
        if candidate.as_ref() != frame_url.as_ref()
            && candidate.as_ref().is_some_and(|url| {
                url.contains("steamstatic.com/")
                    && (url.contains("/community_assets/images/items/") || url.contains("avatars."))
            })
        {
            avatar_url = candidate;
            break;
        }
    }

    Some(ProfileMedia {
        avatar_url,
        frame_url,
    })
}

fn allowed_media_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    let host = url.host_str()?;
    (url.scheme() == "https" && (host == "steamstatic.com" || host.ends_with(".steamstatic.com")))
        .then_some(url)
}

fn download(client: &Client, value: &str) -> AppResult<Vec<u8>> {
    let url = allowed_media_url(value)
        .ok_or_else(|| AppError::new("STEAM_MEDIA_URL_INVALID", "Steam 头像资源地址无效"))?;
    let response = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| {
            AppError::new("STEAM_MEDIA_DOWNLOAD_FAILED", "无法读取 Steam 头像资源")
                .detail(error.to_string())
        })?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MEDIA_BYTES as u64)
    {
        return Err(AppError::new(
            "STEAM_MEDIA_TOO_LARGE",
            "Steam 头像资源超过大小限制",
        ));
    }
    let bytes = response
        .bytes()
        .map_err(|error| {
            AppError::new("STEAM_MEDIA_DOWNLOAD_FAILED", "无法读取 Steam 头像资源")
                .detail(error.to_string())
        })?
        .to_vec();
    if bytes.len() > MAX_MEDIA_BYTES || super::avatar_extension(&bytes).is_none() {
        return Err(AppError::new(
            "STEAM_MEDIA_FORMAT_INVALID",
            "Steam 头像资源格式无效",
        ));
    }
    Ok(bytes)
}

fn cache_path(cache_root: &Path, steam_id64: &str, frame: bool, extension: &str) -> PathBuf {
    let suffix = if frame { ".frame" } else { "" };
    cache_root.join(format!("{steam_id64}{suffix}.{extension}"))
}

fn cache_bytes(
    cache_root: &Path,
    steam_id64: &str,
    frame: bool,
    bytes: &[u8],
) -> AppResult<PathBuf> {
    let extension = super::avatar_extension(bytes)
        .ok_or_else(|| AppError::new("STEAM_MEDIA_FORMAT_INVALID", "Steam 头像资源格式无效"))?;
    let destination = cache_path(cache_root, steam_id64, frame, extension);
    if fs::read(&destination).ok().as_deref() != Some(bytes) {
        fs::write(&destination, bytes)?;
    }
    for stale_extension in MEDIA_EXTENSIONS {
        if stale_extension != extension {
            let _ = fs::remove_file(cache_path(cache_root, steam_id64, frame, stale_extension));
        }
    }
    Ok(destination)
}

fn marker_path(cache_root: &Path, steam_id64: &str) -> PathBuf {
    cache_root.join(format!("{steam_id64}.profile-media"))
}

fn cache_is_fresh(cache_root: &Path, steam_id64: &str, now: i64) -> bool {
    fs::read_to_string(marker_path(cache_root, steam_id64))
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .is_some_and(|checked_at| now.saturating_sub(checked_at) < CACHE_TTL_SECONDS)
}

fn cache_profile_media_from_html(
    client: &Client,
    cache_root: &Path,
    steam_id64: &str,
    html: &str,
) -> AppResult<Option<usize>> {
    let Some(media) = parse_profile_media(html) else {
        return Ok(None);
    };
    let mut synced = 0;
    if let Some(url) = media.avatar_url {
        if let Ok(bytes) = download(client, &url) {
            cache_bytes(cache_root, steam_id64, false, &bytes)?;
            synced += 1;
        }
    }
    if let Some(url) = media.frame_url {
        if let Ok(bytes) = download(client, &url) {
            cache_bytes(cache_root, steam_id64, true, &bytes)?;
            synced += 1;
        }
    } else {
        for extension in MEDIA_EXTENSIONS {
            let _ = fs::remove_file(cache_path(cache_root, steam_id64, true, extension));
        }
    }
    Ok(Some(synced))
}

pub fn sync(cache_root: &Path, steam_ids: &[String], force: bool) -> AppResult<usize> {
    fs::create_dir_all(cache_root)?;
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(8))
        .user_agent(concat!("SteamAccountManager/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| {
            AppError::new("STEAM_MEDIA_CLIENT_FAILED", "无法初始化 Steam 头像同步")
                .detail(error.to_string())
        })?;
    let now = chrono::Utc::now().timestamp();
    let mut synced = 0;

    for steam_id64 in steam_ids {
        if !force && cache_is_fresh(cache_root, steam_id64, now) {
            continue;
        }
        let profile = client
            .get(format!("https://steamcommunity.com/profiles/{steam_id64}"))
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.text());
        if let Ok(html) = profile {
            let Some(media_count) =
                cache_profile_media_from_html(&client, cache_root, steam_id64, &html)?
            else {
                continue;
            };
            synced += media_count;
            let _ = fs::write(marker_path(cache_root, steam_id64), now.to_string());
        }
    }
    Ok(synced)
}

pub fn frame_path(cache_root: &Path, steam_id64: &str) -> Option<PathBuf> {
    MEDIA_EXTENSIONS
        .into_iter()
        .map(|extension| cache_path(cache_root, steam_id64, true, extension))
        .find(|path| path.is_file())
}

pub fn media_version(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(format!("{}-{}", modified.as_nanos(), metadata.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dynamic_avatar_and_frame_from_public_profile_markup() {
        let html = r#"
          <div class="playerAvatarAutoSizeInner">
            <div class="profile_avatar_frame">
              <picture><source srcset="reduced.png"><img src="https://shared.fastly.steamstatic.com/community_assets/images/items/1/frame.png"></picture>
            </div>
            <picture>
              <source media="(prefers-reduced-motion: reduce)" srcset="static.jpg">
              <img srcset="https://shared.fastly.steamstatic.com/community_assets/images/items/1/avatar.gif">
            </picture>
          </div>
          <div class="profile_header_summary"></div>
        "#;

        assert_eq!(
            parse_profile_media(html),
            Some(ProfileMedia {
                avatar_url: Some("https://shared.fastly.steamstatic.com/community_assets/images/items/1/avatar.gif".into()),
                frame_url: Some("https://shared.fastly.steamstatic.com/community_assets/images/items/1/frame.png".into()),
            })
        );
    }

    #[test]
    fn parses_avatar_frame_from_srcset() {
        let html = r#"
          <div class="playerAvatarAutoSizeInner">
            <div class="profile_avatar_frame"><img srcset="https://shared.fastly.steamstatic.com/community_assets/images/items/1/frame.webp 1x"></div>
            <img src="https://avatars.fastly.steamstatic.com/avatar.jpg">
          </div>
          <div class="profile_header_summary"></div>
        "#;

        assert_eq!(
            parse_profile_media(html).and_then(|media| media.frame_url),
            Some(
                "https://shared.fastly.steamstatic.com/community_assets/images/items/1/frame.webp"
                    .into()
            )
        );
    }

    #[test]
    fn rejects_unknown_profile_markup() {
        assert_eq!(
            parse_profile_media("<html>temporarily unavailable</html>"),
            None
        );
    }

    #[test]
    fn unknown_profile_markup_preserves_cached_frame_and_retry_marker() {
        let cache = tempfile::tempdir().expect("cache");
        let steam_id = "76561198000000001";
        let frame = cache_path(cache.path(), steam_id, true, "png");
        fs::write(&frame, b"remembered-frame").expect("cached frame");
        let client = Client::builder().build().expect("client");

        assert_eq!(
            cache_profile_media_from_html(
                &client,
                cache.path(),
                steam_id,
                "<html>temporarily unavailable</html>",
            )
            .expect("unknown markup"),
            None
        );
        assert!(frame.is_file());
        assert!(!marker_path(cache.path(), steam_id).exists());
    }

    #[test]
    fn caches_avatar_frame_without_modifying_its_bytes() {
        let cache = tempfile::tempdir().expect("cache");
        let frame = b"\x89PNG\r\n\x1a\nanimated-frame";
        let path =
            cache_bytes(cache.path(), "76561198000000001", true, frame).expect("cache frame");

        assert_eq!(path.file_name().unwrap(), "76561198000000001.frame.png");
        assert_eq!(fs::read(path).expect("read frame"), frame);
    }

    #[test]
    fn media_version_changes_when_cached_content_changes() {
        let cache = tempfile::tempdir().expect("cache");
        let path = cache.path().join("avatar.png");
        fs::write(&path, b"first").expect("first media");
        let first = media_version(&path).expect("first version");
        fs::write(&path, b"second-content").expect("second media");
        let second = media_version(&path).expect("second version");

        assert_ne!(first, second);
    }
}
