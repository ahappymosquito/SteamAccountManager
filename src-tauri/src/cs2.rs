//! Managed CS2 cfg profiles, safe runtime previews, and switch-time deployment.
use crate::database::Database;
use crate::error::{AppError, AppResult};
use crate::models::{CfgProfile, Cs2RuntimeFile};
use crate::steam;
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;
const MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;

pub fn validate_cfg_file_name(file_name: &str) -> AppResult<String> {
    let trimmed = file_name.trim();
    if !trimmed.to_ascii_lowercase().ends_with(".cfg")
        || trimmed.len() > 96
        || trimmed
            .chars()
            .any(|character| !(character.is_ascii_alphanumeric() || "-_.".contains(character)))
    {
        return Err(AppError::new(
            "CFG_FILE_NAME_INVALID",
            "cfg 文件名只能包含字母、数字、短横线、下划线，并以 .cfg 结尾",
        ));
    }
    Ok(trimmed.to_string())
}

pub fn unique_cfg_file_name(requested: &str, existing: &[String]) -> String {
    let known = existing
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let stem = requested
        .rsplit_once('.')
        .map_or(requested, |(stem, _)| stem);
    let mut candidate = requested.to_string();
    let mut suffix = 2;
    while known.contains(&candidate.to_ascii_lowercase()) {
        candidate = format!("{stem}-{suffix}.cfg");
        suffix += 1;
    }
    candidate
}

pub fn managed_file(data_dir: &Path, file_name: &str) -> PathBuf {
    data_dir.join("cfg-library").join(file_name)
}

pub fn write_managed_profile(data_dir: &Path, profile: &CfgProfile) -> AppResult<()> {
    let directory = data_dir.join("cfg-library");
    fs::create_dir_all(&directory)?;
    let path = managed_file(data_dir, &profile.file_name);
    if path.exists() {
        steam::atomic_write_text(&path, &profile.content)
    } else {
        fs::write(path, profile.content.as_bytes())?;
        Ok(())
    }
}

fn quoted_value(input: &str, key: &str) -> Option<String> {
    input.lines().find_map(|line| {
        let parts = line.split('"').collect::<Vec<_>>();
        (parts.len() >= 4 && parts[1].eq_ignore_ascii_case(key))
            .then(|| parts[3].replace("\\\\", "\\"))
    })
}

fn steam_library_roots(steam_dir: &Path) -> Vec<PathBuf> {
    let mut roots = vec![steam_dir.to_path_buf()];
    let library_file = steam_dir.join("steamapps").join("libraryfolders.vdf");
    if let Ok(content) = fs::read_to_string(library_file) {
        let quoted = content
            .split('"')
            .enumerate()
            .filter_map(|(index, value)| (index % 2 == 1).then_some(value))
            .collect::<Vec<_>>();
        for pair in quoted.windows(2) {
            if pair[0].eq_ignore_ascii_case("path") {
                roots.push(PathBuf::from(pair[1].replace("\\\\", "\\")));
            }
        }
    }
    let mut seen = HashSet::new();
    roots.retain(|root| seen.insert(root.to_string_lossy().to_ascii_lowercase()));
    roots
}

pub fn cs2_cfg_directory(steam_dir: &Path) -> AppResult<PathBuf> {
    for root in steam_library_roots(steam_dir) {
        let manifest = root.join("steamapps").join("appmanifest_730.acf");
        let Ok(content) = fs::read_to_string(&manifest) else {
            continue;
        };
        let install_dir = quoted_value(&content, "installdir")
            .unwrap_or_else(|| "Counter-Strike Global Offensive".to_string());
        let cfg = root
            .join("steamapps")
            .join("common")
            .join(install_dir)
            .join("game")
            .join("csgo")
            .join("cfg");
        if cfg.is_dir() {
            return Ok(cfg);
        }
    }
    Err(AppError::new(
        "CS2_INSTALLATION_NOT_FOUND",
        "未找到 CS2 安装目录，请先在 Steam 安装并运行一次 CS2",
    ))
}

pub fn is_installed(steam_dir: &Path) -> bool {
    cs2_cfg_directory(steam_dir).is_ok()
}

fn account_id32(steam_id64: &str) -> AppResult<u64> {
    let id = steam_id64
        .parse::<u64>()
        .map_err(|_| AppError::new("INVALID_STEAM_ID", "SteamID64 无效"))?;
    id.checked_sub(STEAM_ID64_BASE)
        .ok_or_else(|| AppError::new("INVALID_STEAM_ID", "SteamID64 无效"))
}

fn sha256(path: &Path) -> AppResult<Vec<u8>> {
    Ok(Sha256::digest(fs::read(path)?).to_vec())
}

pub fn prepare_for_switch(
    db: &Database,
    data_dir: &Path,
    steam_dir: &Path,
    steam_id64: &str,
) -> AppResult<Option<String>> {
    let profile = db.ensure_active_cfg_profile()?;
    let previous_file = db.last_applied_cfg_file(steam_id64)?;
    let file_name = validate_cfg_file_name(&profile.file_name)?;
    let managed = managed_file(data_dir, &file_name);
    if !managed.is_file() || fs::read_to_string(&managed)? != profile.content {
        write_managed_profile(data_dir, &profile)?;
    }
    let target = cs2_cfg_directory(steam_dir)?.join(&file_name);
    fs::copy(&managed, &target).map_err(|error| {
        AppError::new("CFG_COPY_FAILED", "无法复制所选 CS2 cfg")
            .detail(format!("{}: {error}", target.display()))
    })?;
    if sha256(&managed)? != sha256(&target)? {
        return Err(
            AppError::new("CFG_VERIFY_FAILED", "CS2 cfg 复制后校验不一致")
                .detail(target.to_string_lossy()),
        );
    }

    let local_config = steam_dir
        .join("userdata")
        .join(account_id32(steam_id64)?.to_string())
        .join("config")
        .join("localconfig.vdf");
    if !local_config.is_file() {
        return Err(AppError::new(
            "STEAM_LOCALCONFIG_NOT_FOUND",
            "找不到该账号的 Steam 启动参数文件",
        )
        .detail(local_config.to_string_lossy()));
    }
    let original = fs::read_to_string(&local_config)?;
    let patched =
        steam::vdf::patch_cs2_launch_options(&original, previous_file.as_deref(), &file_name)?;
    if patched != original {
        steam::atomic_write_text(&local_config, &patched)?;
    }
    db.mark_cfg_applied(steam_id64, &file_name)?;
    Ok(Some(file_name))
}

pub fn list_runtime_files(steam_dir: &Path) -> AppResult<Vec<Cs2RuntimeFile>> {
    let mut files = Vec::new();
    for config in steam::discover_cs2_configs(steam_dir)? {
        for entry in fs::read_dir(&config.path)?.filter_map(Result::ok) {
            let path = entry.path();
            if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if !["cfg", "vcfg", "txt"]
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
            {
                continue;
            }
            let metadata = entry.metadata()?;
            let modified_at = metadata
                .modified()
                .ok()
                .map(DateTime::<Utc>::from)
                .map(|value| value.to_rfc3339());
            files.push(Cs2RuntimeFile {
                steam_id64: config.steam_id64.clone(),
                path: path.to_string_lossy().into_owned(),
                name,
                size: metadata.len(),
                modified_at,
                editable: extension.eq_ignore_ascii_case("cfg"),
            });
        }
    }
    files.sort_by(|left, right| {
        left.steam_id64
            .cmp(&right.steam_id64)
            .then(left.name.cmp(&right.name))
    });
    Ok(files)
}

pub fn preview_runtime_file(steam_dir: &Path, requested: &Path) -> AppResult<String> {
    let root = steam_dir.join("userdata").canonicalize()?;
    let path = requested.canonicalize()?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(AppError::new(
            "CFG_PREVIEW_PATH_INVALID",
            "只能预览 Steam userdata 中的 CS2 配置文件",
        ));
    }
    let metadata = fs::metadata(&path)?;
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Err(AppError::new(
            "CFG_PREVIEW_TOO_LARGE",
            "配置文件超过 2 MB，无法预览",
        ));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !["cfg", "vcfg", "txt"]
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
    {
        return Err(AppError::new(
            "CFG_PREVIEW_TYPE_INVALID",
            "该文件类型不支持预览",
        ));
    }
    fs::read_to_string(path)
        .map_err(|_| AppError::new("CFG_PREVIEW_ENCODING", "配置文件不是有效 UTF-8 文本"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_managed_cfg_file_names() {
        assert_eq!(
            validate_cfg_file_name("practice.cfg").expect("valid name"),
            "practice.cfg"
        );
        assert!(validate_cfg_file_name("../autoexec.cfg").is_err());
        assert!(validate_cfg_file_name("config.txt").is_err());
    }

    #[test]
    fn suffixes_duplicate_import_names() {
        assert_eq!(
            unique_cfg_file_name(
                "autoexec.cfg",
                &["autoexec.cfg".into(), "autoexec-2.cfg".into()]
            ),
            "autoexec-3.cfg"
        );
    }

    #[test]
    fn resolves_cs2_cfg_from_library_manifest() {
        let steam = tempfile::tempdir().expect("steam root");
        let library = tempfile::tempdir().expect("library root");
        fs::create_dir_all(steam.path().join("steamapps")).expect("steamapps");
        fs::write(
            steam.path().join("steamapps/libraryfolders.vdf"),
            format!(
                "\"libraryfolders\" {{ \"1\" {{ \"path\" \"{}\" }} }}",
                library.path().display()
            ),
        )
        .expect("libraries");
        fs::create_dir_all(library.path().join("steamapps")).expect("library steamapps");
        fs::write(
            library.path().join("steamapps/appmanifest_730.acf"),
            "\"AppState\" { \"installdir\" \"Counter-Strike Global Offensive\" }",
        )
        .expect("manifest");
        let cfg = library
            .path()
            .join("steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg");
        fs::create_dir_all(&cfg).expect("cfg");

        assert_eq!(cs2_cfg_directory(steam.path()).expect("resolve"), cfg);
        assert!(is_installed(steam.path()));
    }

    #[test]
    fn reports_cs2_missing_without_an_install_manifest() {
        let steam = tempfile::tempdir().expect("steam root");

        assert!(!is_installed(steam.path()));
    }
}
