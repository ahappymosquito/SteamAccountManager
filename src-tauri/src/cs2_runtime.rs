//! 采集、转换并记录各 Steam 账号 userdata 中已运行过的 CS2 配置。
use crate::cs2::{
    account_id32, sha256_hex, unique_cfg_file_name, userdata_cfg_directory, write_managed_profile,
};
use crate::database::Database;
use crate::error::{AppError, AppResult};
use crate::models::{CfgCaptureResult, CfgProfile, CfgRuntimeFileMeta};
use crate::steam::vdf;
use chrono::{DateTime, Utc};
use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};
use sysinfo::{ProcessesToUpdate, System};

const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SNAPSHOTS_PER_ACCOUNT: usize = 10;
const STRUCTURAL_KEYS: &[&str] = &["config", "convars", "bindings", "data", "root"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeFileKind {
    UserConvars,
    UserKeys,
    UserCfg,
    Machine,
    Video,
    Derivative,
    Other,
}

impl RuntimeFileKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::UserConvars => "user_convars",
            Self::UserKeys => "user_keys",
            Self::UserCfg => "user_cfg",
            Self::Machine => "machine",
            Self::Video => "video",
            Self::Derivative => "derivative",
            Self::Other => "other",
        }
    }

    fn included(self) -> bool {
        matches!(self, Self::UserConvars | Self::UserKeys | Self::UserCfg)
    }
}

pub fn cs2_process_running() -> bool {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system.processes().values().any(|process| {
        let name = process.name().to_string_lossy();
        name.eq_ignore_ascii_case("cs2.exe") || name.eq_ignore_ascii_case("cs2")
    })
}

fn classify_runtime_file(name: &str) -> RuntimeFileKind {
    let lower = name.to_ascii_lowercase();
    if lower.contains("lastclouded") || lower == "steam_autocloud.vdf" {
        RuntimeFileKind::Derivative
    } else if lower.starts_with("cs2_user_convars") && lower.ends_with(".vcfg") {
        RuntimeFileKind::UserConvars
    } else if lower.starts_with("cs2_user_keys") && lower.ends_with(".vcfg") {
        RuntimeFileKind::UserKeys
    } else if lower.starts_with("cs2_machine") {
        RuntimeFileKind::Machine
    } else if lower.starts_with("cs2_video") {
        RuntimeFileKind::Video
    } else if lower.ends_with(".cfg") {
        RuntimeFileKind::UserCfg
    } else {
        RuntimeFileKind::Other
    }
}

fn system_time_rfc3339(time: SystemTime) -> Option<String> {
    Some(DateTime::<Utc>::from(time).to_rfc3339())
}

fn unescape_quoted(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(character) = chars.next() {
        if character == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        } else {
            out.push(character);
        }
    }
    out
}

fn take_quoted(input: &str) -> Option<(String, &str)> {
    let input = input.trim_start();
    if !input.starts_with('"') {
        return None;
    }
    let mut escaped = false;
    for (index, character) in input[1..].char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if character == '"' {
            let raw = &input[1..1 + index];
            return Some((unescape_quoted(raw), &input[1 + index + 1..]));
        }
    }
    None
}

fn scan_quoted_pairs(input: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let mut rest = input;
    while let Some(quote) = rest.find('"') {
        rest = &rest[quote..];
        let Some((key, after_key)) = take_quoted(rest) else {
            break;
        };
        let mut cursor = after_key.trim_start();
        if cursor.starts_with('=') {
            cursor = cursor[1..].trim_start();
        }
        if let Some((value, after_value)) = take_quoted(cursor) {
            pairs.push((key, value));
            rest = after_value;
        } else {
            rest = after_key;
        }
    }
    pairs
}

fn scan_ident_assignments(input: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("//") || trimmed.starts_with("<!--") {
            continue;
        }
        let Some(equals) = trimmed.find('=') else {
            continue;
        };
        let key = trimmed[..equals].trim();
        if key.is_empty()
            || key.contains('"')
            || !key
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            continue;
        }
        if let Some((value, _)) = take_quoted(trimmed[equals + 1..].trim_start()) {
            pairs.push((key.to_string(), value));
        }
    }
    pairs
}

fn is_structural_key(key: &str) -> bool {
    STRUCTURAL_KEYS
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(key))
}

pub fn extract_vcfg_pairs(input: &str) -> Vec<(String, String)> {
    let mut pairs = vdf::collect_text_leaves(input).unwrap_or_default();
    if pairs.is_empty() {
        pairs = scan_quoted_pairs(input);
    }
    if pairs.is_empty() {
        pairs = scan_ident_assignments(input);
    }
    pairs
        .into_iter()
        .filter(|(key, value)| !is_structural_key(key) && !value.trim().is_empty())
        .collect()
}

fn needs_cfg_quotes(value: &str) -> bool {
    value.is_empty()
        || value.chars().any(|character| {
            character.is_whitespace() || matches!(character, '"' | ';' | '\\' | '/')
        })
}

fn quote_cfg_token(value: &str) -> String {
    if needs_cfg_quotes(value) {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

pub fn convars_to_cfg(pairs: &[(String, String)]) -> String {
    let mut lines = pairs
        .iter()
        .filter(|(key, _)| !key.eq_ignore_ascii_case("<unbound>"))
        .map(|(key, value)| format!("{} {}", key, quote_cfg_token(value)))
        .collect::<Vec<_>>();
    lines.sort();
    lines.join("\n")
}

pub fn binds_to_cfg(pairs: &[(String, String)]) -> String {
    let mut lines = pairs
        .iter()
        .filter(|(_, value)| !value.eq_ignore_ascii_case("<unbound>"))
        .map(|(key, value)| {
            format!(
                "bind \"{}\" \"{}\"",
                key.replace('\\', "\\\\").replace('"', "\\\""),
                value.replace('\\', "\\\\").replace('"', "\\\"")
            )
        })
        .collect::<Vec<_>>();
    lines.sort();
    lines.join("\n")
}

fn read_limited_text(path: &Path) -> AppResult<String> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(AppError::new(
            "CFG_RUNTIME_TOO_LARGE",
            "运行配置文件超过 2 MB，已跳过内容",
        ));
    }
    fs::read_to_string(path)
        .map_err(|_| AppError::new("CFG_RUNTIME_ENCODING", "运行配置不是有效的 UTF-8 文本"))
}

fn archive_dir(data_dir: &Path, steam_id64: &str, content_hash: &str) -> PathBuf {
    data_dir
        .join("cfg-runtime")
        .join(steam_id64)
        .join(content_hash)
}

fn copy_archive(
    data_dir: &Path,
    steam_id64: &str,
    content_hash: &str,
    files: &[(PathBuf, String)],
) {
    let directory = archive_dir(data_dir, steam_id64, content_hash);
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    for (path, name) in files {
        let _ = fs::copy(path, directory.join(name));
    }
}

fn remove_archive(data_dir: &Path, steam_id64: &str, content_hash: &str) {
    let directory = archive_dir(data_dir, steam_id64, content_hash);
    let _ = fs::remove_dir_all(directory);
}

fn newest_entry_time(cfg_dir: &Path) -> Option<DateTime<Utc>> {
    fs::read_dir(cfg_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .metadata()
                .ok()?
                .modified()
                .ok()
                .map(DateTime::<Utc>::from)
        })
        .max()
}

fn should_reread(cfg_dir: &Path, last_seen: Option<&str>, force: bool) -> bool {
    if force {
        return true;
    }
    let Some(last_seen) = last_seen else {
        return true;
    };
    let Ok(threshold) = DateTime::parse_from_rfc3339(last_seen) else {
        return true;
    };
    newest_entry_time(cfg_dir).is_none_or(|mtime| mtime >= threshold.with_timezone(&Utc))
}

fn runtime_profile_name(persona: Option<&str>, account: Option<&str>, steam_id64: &str) -> String {
    let label = persona
        .filter(|value| !value.trim().is_empty())
        .or(account)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(steam_id64);
    let name = format!("运行 · {label}");
    if name.chars().count() > 80 {
        format!("运行 · {}", label.chars().take(72).collect::<String>())
    } else {
        name
    }
}

fn build_cfg_document(
    persona: Option<&str>,
    account: Option<&str>,
    source_path: &str,
    captured_at: &str,
    convars: &str,
    binds: &str,
    user_cfgs: &[(String, String)],
) -> String {
    let mut out = String::from("// Steam Account Manager 从本机 CS2 运行配置生成\n");
    let label = persona
        .filter(|value| !value.trim().is_empty())
        .or(account)
        .unwrap_or("未知账号");
    out.push_str(&format!("// 账号: {label}\n"));
    out.push_str(&format!("// 采集时间: {captured_at}\n"));
    out.push_str(&format!("// 来源: {source_path}\n"));
    out.push_str("// 仅包含用户 ConVar、按键和自建 CFG，不含机器/视频设置\n");
    if !convars.is_empty() {
        out.push_str("\n// --- 用户 ConVar ---\n");
        out.push_str(convars);
        out.push('\n');
    }
    if !binds.is_empty() {
        out.push_str("\n// --- 按键绑定 ---\n");
        out.push_str(binds);
        out.push('\n');
    }
    for (name, content) in user_cfgs {
        out.push_str(&format!("\n// --- 用户 CFG ({name}) ---\n"));
        out.push_str(content.trim_end());
        out.push('\n');
    }
    out
}

fn is_comment_only(cfg_content: &str) -> bool {
    cfg_content
        .lines()
        .all(|line| line.trim().is_empty() || line.trim_start().starts_with("//"))
}

struct AccountRef<'a> {
    id: &'a str,
    steam_id64: &'a str,
    persona: Option<&'a str>,
    account: Option<&'a str>,
}

fn sync_runtime_profile(
    db: &Database,
    data_dir: &Path,
    account: &AccountRef<'_>,
    content_hash: &str,
    cfg_content: &str,
    overwrite: bool,
) -> AppResult<Option<CfgProfile>> {
    if is_comment_only(cfg_content) {
        return Ok(None);
    }
    if let Some((profile, last_synced_hash)) = db.runtime_profile_state(account.id)? {
        let last_synced_content = db.runtime_synced_cfg_content(account.id, &last_synced_hash)?;
        let user_untouched = last_synced_content
            .as_deref()
            .is_none_or(|content| content == profile.content);
        if overwrite || user_untouched {
            db.save_cfg_profile(&profile.id, &profile.name, cfg_content)?;
            db.link_runtime_profile(account.id, &profile.id, content_hash)?;
            let updated = CfgProfile {
                content: cfg_content.to_string(),
                source: "runtime".into(),
                ..profile
            };
            write_managed_profile(data_dir, &updated)?;
            return Ok(Some(updated));
        }
        return Ok(Some(profile));
    }
    let name = runtime_profile_name(account.persona, account.account, account.steam_id64);
    let account_id = account_id32(account.steam_id64)?;
    let existing = db
        .list_cfg_profiles()?
        .into_iter()
        .map(|profile| profile.file_name)
        .collect::<Vec<_>>();
    let file_name = unique_cfg_file_name(&format!("runtime-{account_id}.cfg"), &existing);
    let profile = db.create_cfg_profile(&name, &file_name, cfg_content)?;
    let profile = CfgProfile {
        source: "runtime".into(),
        ..profile
    };
    if let Err(error) = write_managed_profile(data_dir, &profile) {
        let _ = db.delete_cfg_profile(&profile.id);
        return Err(error);
    }
    db.link_runtime_profile(account.id, &profile.id, content_hash)?;
    if db.cfg_assignment_profile_id(account.id)?.is_none() {
        db.assign_cfg_profile(account.id, &profile.id)?;
    }
    Ok(Some(profile))
}

fn capture_account(
    db: &Database,
    data_dir: &Path,
    steam_dir: &Path,
    account: &AccountRef<'_>,
    trigger: &str,
    force: bool,
) -> AppResult<bool> {
    let cfg_dir = userdata_cfg_directory(steam_dir, account.steam_id64)?;
    if !cfg_dir.is_dir() {
        return Ok(false);
    }
    let last_seen = db.latest_runtime_snapshot_seen_at(account.id)?;
    if !should_reread(&cfg_dir, last_seen.as_deref(), force) {
        return Ok(false);
    }
    let mut metas = Vec::new();
    let mut included_files = Vec::new();
    let mut hash_input = Vec::new();
    let mut convars = String::new();
    let mut binds = String::new();
    let mut user_cfgs = Vec::new();
    let mut entries = fs::read_dir(&cfg_dir)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    entries.sort();
    for path in entries {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let kind = classify_runtime_file(name);
        let metadata = fs::metadata(&path)?;
        let bytes = fs::read(&path)?;
        let digest = sha256_hex(&bytes);
        let included = kind.included() && metadata.len() <= MAX_TEXT_FILE_BYTES;
        metas.push(CfgRuntimeFileMeta {
            name: name.to_string(),
            size: metadata.len(),
            modified_at: metadata.modified().ok().and_then(system_time_rfc3339),
            sha256: digest.clone(),
            kind: kind.as_str().to_string(),
            included,
        });
        if !included {
            continue;
        }
        hash_input.push(format!("{name}={digest}"));
        included_files.push((path.clone(), name.to_string()));
        let Ok(text) = read_limited_text(&path) else {
            continue;
        };
        match kind {
            RuntimeFileKind::UserConvars => {
                let converted = convars_to_cfg(&extract_vcfg_pairs(&text));
                if !converted.is_empty() {
                    convars = converted;
                }
            }
            RuntimeFileKind::UserKeys => {
                let converted = binds_to_cfg(&extract_vcfg_pairs(&text));
                if !converted.is_empty() {
                    binds = converted;
                }
            }
            RuntimeFileKind::UserCfg => user_cfgs.push((name.to_string(), text)),
            _ => {}
        }
    }
    if hash_input.is_empty() {
        return Ok(false);
    }
    hash_input.sort();
    let content_hash = sha256_hex(hash_input.join("\n").as_bytes());
    let captured_at = Utc::now().to_rfc3339();
    let source_path = cfg_dir.to_string_lossy();
    let cfg_content = build_cfg_document(
        account.persona,
        account.account,
        &source_path,
        &captured_at,
        &convars,
        &binds,
        &user_cfgs,
    );
    let files_json = serde_json::to_string(&metas)
        .map_err(|error| AppError::new("CFG_RUNTIME_STATE", error.to_string()))?;
    let (_id, created) = db.record_runtime_snapshot(&crate::database::RuntimeSnapshotInput {
        steam_account_id: account.id,
        trigger,
        source_path: &source_path,
        content_hash: &content_hash,
        file_count: metas.len() as i64,
        files_json: &files_json,
        cfg_content: &cfg_content,
    })?;
    if created {
        copy_archive(data_dir, account.steam_id64, &content_hash, &included_files);
        let removed = db.prune_runtime_snapshots(account.id, MAX_SNAPSHOTS_PER_ACCOUNT)?;
        for hash in removed {
            remove_archive(data_dir, account.steam_id64, &hash);
        }
    }
    if created || db.runtime_profile_state(account.id)?.is_none() {
        let document = if created {
            cfg_content
        } else {
            db.runtime_synced_cfg_content(account.id, &content_hash)?
                .unwrap_or(cfg_content)
        };
        let _ = sync_runtime_profile(db, data_dir, account, &content_hash, &document, false)?;
    }
    Ok(created)
}

pub fn capture_runtime_cfgs(
    db: &Database,
    data_dir: &Path,
    steam_dir: &Path,
    trigger: &str,
    force: bool,
) -> AppResult<CfgCaptureResult> {
    if !force && cs2_process_running() {
        return Ok(CfgCaptureResult {
            captured: 0,
            unchanged: 0,
            skipped_running: true,
            accounts: db.list_runtime_cfg_accounts()?,
        });
    }
    let mut captured = 0;
    let mut unchanged = 0;
    for account in db.list_accounts()? {
        let account_ref = AccountRef {
            id: &account.id,
            steam_id64: &account.steam_id64,
            persona: account.persona_name.as_deref(),
            account: account.account_name.as_deref(),
        };
        match capture_account(db, data_dir, steam_dir, &account_ref, trigger, force) {
            Ok(true) => captured += 1,
            Ok(false) => unchanged += 1,
            Err(_) => unchanged += 1,
        }
    }
    Ok(CfgCaptureResult {
        captured,
        unchanged,
        skipped_running: false,
        accounts: db.list_runtime_cfg_accounts()?,
    })
}

pub fn apply_runtime_snapshot(
    db: &Database,
    data_dir: &Path,
    snapshot_id: &str,
) -> AppResult<CfgProfile> {
    let snapshot = db.runtime_snapshot_by_id(snapshot_id)?;
    let account = db
        .list_accounts()?
        .into_iter()
        .find(|account| account.id == snapshot.steam_account_id)
        .ok_or_else(|| AppError::new("ACCOUNT_NOT_FOUND", "找不到对应 Steam 账号"))?;
    let account_ref = AccountRef {
        id: &account.id,
        steam_id64: &account.steam_id64,
        persona: account.persona_name.as_deref(),
        account: account.account_name.as_deref(),
    };
    let profile = sync_runtime_profile(
        db,
        data_dir,
        &account_ref,
        &snapshot.content_hash,
        &snapshot.cfg_content,
        true,
    )?
    .ok_or_else(|| AppError::new("CFG_RUNTIME_EMPTY", "该运行配置没有可导入的命令"))?;
    db.set_active_cfg_profile(&profile.id)?;
    Ok(profile)
}

pub fn open_runtime_snapshot(
    db: &Database,
    data_dir: &Path,
    snapshot_id: &str,
) -> AppResult<CfgProfile> {
    let snapshot = db.runtime_snapshot_by_id(snapshot_id)?;
    if let Some((profile, _)) = db.runtime_profile_state(&snapshot.steam_account_id)? {
        db.set_active_cfg_profile(&profile.id)?;
        return Ok(profile);
    }
    apply_runtime_snapshot(db, data_dir, snapshot_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::LocalSteamAccount;

    fn local_account(steam_id64: &str, persona: &str) -> LocalSteamAccount {
        LocalSteamAccount {
            steam_id64: steam_id64.into(),
            account_name: Some("alpha".into()),
            persona_name: Some(persona.into()),
            remember_password: true,
            allow_auto_login: true,
            most_recent: true,
            timestamp: None,
        }
    }

    fn write_vcfg(dir: &Path, name: &str, body: &str) {
        fs::create_dir_all(dir).expect("cfg dir");
        fs::write(dir.join(name), body).expect("write vcfg");
    }

    #[test]
    fn converts_user_convars_and_skips_unbound_keys() {
        let convars = extract_vcfg_pairs(
            r#"
"config"
{
    "convars"
    {
        "sensitivity" "1.25"
        "cl_crosshairsize" "3"
        "volume" "0.5"
    }
}
"#,
        );
        let cfg = convars_to_cfg(&convars);
        assert!(cfg.contains("cl_crosshairsize 3"));
        assert!(cfg.contains("sensitivity 1.25"));
        assert!(cfg.contains("volume 0.5"));

        let binds = binds_to_cfg(&extract_vcfg_pairs(
            r#"
"config"
{
    "bindings"
    {
        "MOUSE1" "+attack"
        "MWHEELDOWN" "+jump"
        "h" "<unbound>"
        "SPACE" "+jump"
    }
}
"#,
        ));
        assert!(binds.contains("bind \"MOUSE1\" \"+attack\""));
        assert!(binds.contains("bind \"MWHEELDOWN\" \"+jump\""));
        assert!(binds.contains("bind \"SPACE\" \"+jump\""));
        assert!(!binds.contains("<unbound>"));
        assert!(!binds.to_ascii_lowercase().contains("bind \"h\""));
    }

    #[test]
    fn falls_back_to_quoted_and_kv3_assignments() {
        let quoted = extract_vcfg_pairs(r#""sensitivity"        "2.5""#);
        assert_eq!(quoted, vec![("sensitivity".into(), "2.5".into())]);
        let kv3 = extract_vcfg_pairs(
            r#"
<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} -->
{
    sensitivity = "1.8"
    cl_righthand = "true"
}
"#,
        );
        assert!(kv3
            .iter()
            .any(|(key, value)| key == "sensitivity" && value == "1.8"));
        assert!(kv3
            .iter()
            .any(|(key, value)| key == "cl_righthand" && value == "true"));
    }

    #[test]
    fn captures_new_runtime_cfg_and_skips_identical_hash() {
        let steam = tempfile::tempdir().expect("steam");
        let data = tempfile::tempdir().expect("data");
        let db = Database::open(&data.path().join("app.db")).expect("db");
        db.sync_accounts(&[local_account("76561198000000000", "主力")])
            .expect("scan");
        let cfg = steam.path().join("userdata/39734272/730/local/cfg");
        write_vcfg(
            &cfg,
            "cs2_user_convars_0_slot0.vcfg",
            r#""config" { "convars" { "sensitivity" "2" "cl_crosshairsize" "4" } }"#,
        );
        write_vcfg(
            &cfg,
            "cs2_user_keys_0_slot0.vcfg",
            r#""config" { "bindings" { "MOUSE1" "+attack" "w" "+forward" } }"#,
        );
        write_vcfg(
            &cfg,
            "cs2_machine_convars.vcfg",
            r#""config" { "convars" { "r_fullscreen_gamma" "2.2" } }"#,
        );

        let first = capture_runtime_cfgs(&db, data.path(), steam.path(), "scan", true)
            .expect("first capture");
        assert_eq!(first.captured, 1);
        assert_eq!(first.accounts.len(), 1);
        assert_eq!(first.accounts[0].file_count, 3);
        assert!(!first.accounts[0].profile_dirty);
        let profile_id = first.accounts[0].profile_id.clone().expect("profile");
        let profile = db
            .list_cfg_profiles()
            .expect("profiles")
            .into_iter()
            .find(|item| item.id == profile_id)
            .expect("runtime profile");
        assert_eq!(profile.source, "runtime");
        assert!(profile.content.contains("sensitivity 2"));
        assert!(profile.content.contains("bind \"MOUSE1\" \"+attack\""));
        assert!(!profile.content.contains("r_fullscreen_gamma"));
        assert!(archive_dir(
            data.path(),
            "76561198000000000",
            &first.accounts[0].content_hash
        )
        .is_dir());

        let second = capture_runtime_cfgs(&db, data.path(), steam.path(), "scan", true)
            .expect("second capture");
        assert_eq!(second.captured, 0);
        assert_eq!(
            db.list_runtime_cfg_snapshots(&first.accounts[0].steam_account_id)
                .expect("history")
                .len(),
            1
        );
    }

    #[test]
    fn does_not_overwrite_user_edited_runtime_profile() {
        let steam = tempfile::tempdir().expect("steam");
        let data = tempfile::tempdir().expect("data");
        let db = Database::open(&data.path().join("app.db")).expect("db");
        db.sync_accounts(&[local_account("76561198000000000", "主力")])
            .expect("scan");
        let cfg = steam.path().join("userdata/39734272/730/local/cfg");
        write_vcfg(
            &cfg,
            "cs2_user_convars_0_slot0.vcfg",
            r#""config" { "convars" { "sensitivity" "1" } }"#,
        );
        let first =
            capture_runtime_cfgs(&db, data.path(), steam.path(), "scan", true).expect("first");
        let profile_id = first.accounts[0].profile_id.clone().expect("profile");
        db.save_cfg_profile(&profile_id, "运行 · 主力", "sensitivity 9\n")
            .expect("user edit");
        write_vcfg(
            &cfg,
            "cs2_user_convars_0_slot0.vcfg",
            r#""config" { "convars" { "sensitivity" "3" } }"#,
        );
        let second =
            capture_runtime_cfgs(&db, data.path(), steam.path(), "manual", true).expect("second");
        assert_eq!(second.captured, 1);
        assert!(second.accounts[0].profile_dirty);
        let profile = db
            .list_cfg_profiles()
            .expect("profiles")
            .into_iter()
            .find(|item| item.id == profile_id)
            .expect("kept profile");
        assert_eq!(profile.content, "sensitivity 9\n");

        let applied = apply_runtime_snapshot(&db, data.path(), &second.accounts[0].snapshot_id)
            .expect("force apply");
        assert!(applied.content.contains("sensitivity 3"));
        assert!(!db.list_runtime_cfg_accounts().expect("accounts")[0].profile_dirty);
    }
}
