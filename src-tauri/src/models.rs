//! Serializable domain models crossing the Tauri IPC boundary.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSteamAccount {
    pub steam_id64: String,
    pub account_name: Option<String>,
    pub persona_name: Option<String>,
    pub remember_password: bool,
    pub allow_auto_login: bool,
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
    pub last_local_seen_at: Option<String>,
    pub last_switched_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub alias: Option<String>,
    pub remark: Option<String>,
    pub group_name: Option<String>,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub platform_codes: Vec<String>,
    pub player_ranks: Vec<PlayerRankSummary>,
    pub avatar_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerRankSummary {
    pub platform: String,
    pub rank_name: Option<String>,
    pub score: Option<f64>,
    pub score_source: Option<String>,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagOption {
    pub name: String,
    pub usage_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub account_id: String,
    pub alias: Option<String>,
    pub remark: Option<String>,
    pub favorite: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamLoginSession {
    pub id: String,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamLoginStatus {
    pub state: String,
    pub account_id: Option<String>,
    pub message: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    pub sample_size: usize,
    pub kills: i64,
    pub deaths: i64,
    pub kd: Option<f64>,
    pub rating: Option<f64>,
    pub adr: Option<f64>,
    pub headshot_rate: Option<f64>,
    pub win_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerMatch {
    pub match_id: String,
    pub map: Option<String>,
    pub occurred_at: Option<String>,
    pub result: Option<String>,
    pub score: Option<String>,
    pub kills: Option<i64>,
    pub deaths: Option<i64>,
    pub assists: Option<i64>,
    pub rating: Option<f64>,
    pub adr: Option<f64>,
    pub headshot_rate: Option<f64>,
    pub elo_before: Option<f64>,
    pub elo_change: Option<f64>,
    pub elo_after: Option<f64>,
    pub rounds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub platform: String,
    pub external_id: String,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
    pub rank_name: Option<String>,
    pub elo: Option<f64>,
    pub elo_source: Option<String>,
    pub stats: PlayerStats,
    pub recent_matches: Vec<PlayerMatch>,
    pub capabilities: Vec<String>,
    pub warnings: Vec<String>,
    pub fetched_at: String,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCredentialStatus {
    pub platform_code: String,
    pub configured: bool,
    pub expired: bool,
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
    pub platform_count: usize,
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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cs2Config {
    pub steam_id64: String,
    pub path: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CfgProfile {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountCfgAssignment {
    pub steam_account_id: String,
    pub steam_id64: String,
    pub profile_id: String,
    pub profile_name: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareStatus {
    pub code: String,
    pub name: String,
    pub installed: bool,
    pub executable_path: Option<String>,
    pub download_mode: String,
    pub official_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub code: String,
    pub state: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
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
