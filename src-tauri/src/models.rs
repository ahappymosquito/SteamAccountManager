//! Serializable domain models crossing the Tauri IPC boundary.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSteamAccount {
    pub steam_id64: String,
    pub account_name: Option<String>,
    pub persona_name: Option<String>,
    pub remember_password: bool,
    pub most_recent: bool,
    pub timestamp: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub steam_id64: String,
    pub account_name: Option<String>,
    pub persona_name: Option<String>,
    pub local_available: bool,
    pub last_local_seen_at: Option<String>,
    pub last_switched_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub alias: Option<String>,
    pub remark: Option<String>,
    pub group_name: Option<String>,
    pub color: Option<String>,
    pub favorite: bool,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub steam_id64: String,
    pub alias: Option<String>,
    pub remark: Option<String>,
    pub group_name: Option<String>,
    pub color: Option<String>,
    pub favorite: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLink {
    pub id: String,
    pub steam_account_id: String,
    pub platform_code: String,
    pub external_id: Option<String>,
    pub display_name: Option<String>,
    pub profile_url: Option<String>,
    pub remark: Option<String>,
    pub status: String,
    pub last_verified_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLinkInput {
    pub id: Option<String>,
    pub steam_account_id: String,
    pub platform_code: String,
    pub external_id: Option<String>,
    pub display_name: Option<String>,
    pub profile_url: Option<String>,
    pub remark: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentStatus {
    pub kind: String,
    pub account_name: Option<String>,
    pub steam_id64: Option<String>,
    pub steam_running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupSteamResult {
    pub steam_path: Option<String>,
    pub scan_performed: bool,
    pub account_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchResult {
    pub success: bool,
    pub stage: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    pub blocked_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformApp {
    pub platform_code: String,
    pub name: String,
    pub executable_path: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub working_directory: Option<String>,
    pub prelaunch_check: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchLog {
    pub id: String,
    pub steam_account_id: Option<String>,
    pub account_name: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub result: String,
    pub error_message: Option<String>,
}
