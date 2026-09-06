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
    pub platform_summaries: Vec<PlatformSummary>,
    pub player_ranks: Vec<PlayerRankSummary>,
    pub avatar_path: Option<String>,
    pub avatar_version: Option<String>,
    pub avatar_frame_path: Option<String>,
    pub avatar_frame_version: Option<String>,
    #[serde(default)]
    pub local_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSummary {
    pub platform_code: String,
    pub display_name: Option<String>,
    pub external_id: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerRankSummary {
    pub platform: String,
    pub rank_name: Option<String>,
    pub score: Option<f64>,
    pub score_source: Option<String>,
    pub ranking_state: String,
    pub placement_matches: Option<usize>,
    pub previous_season_score: Option<f64>,
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
    pub login_account: Option<String>,
    pub login_password: Option<String>,
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
    pub login_account: Option<String>,
    pub login_password: Option<String>,
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
    #[serde(default = "default_ranking_state")]
    pub ranking_state: String,
    #[serde(default)]
    pub placement_matches: Option<usize>,
    #[serde(default)]
    pub previous_season_score: Option<f64>,
    pub stats: PlayerStats,
    pub recent_matches: Vec<PlayerMatch>,
    pub capabilities: Vec<String>,
    pub warnings: Vec<String>,
    pub fetched_at: String,
    pub stale: bool,
}

fn default_ranking_state() -> String {
    "unknown".to_string()
}

#[cfg(test)]
mod player_snapshot_tests {
    use super::PlayerSnapshot;

    #[test]
    fn old_cached_snapshot_defaults_to_unknown_ranking_state() {
        let snapshot: PlayerSnapshot = serde_json::from_str(
            r#"{
                "platform":"5e",
                "externalId":"player",
                "stats":{"sampleSize":0,"kills":0,"deaths":0},
                "recentMatches":[],
                "capabilities":[],
                "warnings":[],
                "fetchedAt":"2026-07-30T00:00:00Z",
                "stale":false
            }"#,
        )
        .expect("legacy snapshot");

        assert_eq!(snapshot.ranking_state, "unknown");
        assert_eq!(snapshot.placement_matches, None);
        assert_eq!(snapshot.previous_season_score, None);
    }
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
    pub persona_name: Option<String>,
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
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchProgress {
    pub stage: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub schema_version: u64,
    pub exported_at: String,
    pub account_count: usize,
    pub platform_link_count: usize,
    pub cfg_profile_count: usize,
    pub matched_account_count: usize,
    pub skipped_account_count: usize,
    pub matched_platform_link_count: usize,
    pub setting_count: usize,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSelection {
    pub accounts: bool,
    pub cfg: bool,
    pub settings: bool,
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

fn manual_cfg_source() -> String {
    "manual".into()
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
    #[serde(default = "manual_cfg_source")]
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CfgRuntimeFileMeta {
    pub name: String,
    pub size: u64,
    pub modified_at: Option<String>,
    pub sha256: String,
    pub kind: String,
    pub included: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CfgRuntimeAccountSummary {
    pub steam_account_id: String,
    pub steam_id64: String,
    pub persona_name: Option<String>,
    pub account_name: Option<String>,
    pub snapshot_id: String,
    pub captured_at: String,
    pub last_seen_at: String,
    pub trigger: String,
    pub source_path: String,
    pub content_hash: String,
    pub file_count: i64,
    pub files: Vec<CfgRuntimeFileMeta>,
    pub history_count: i64,
    pub profile_id: Option<String>,
    pub profile_name: Option<String>,
    pub profile_file_name: Option<String>,
    pub profile_dirty: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CfgRuntimeSnapshot {
    pub id: String,
    pub steam_account_id: String,
    pub captured_at: String,
    pub last_seen_at: String,
    pub trigger: String,
    pub source_path: String,
    pub content_hash: String,
    pub file_count: i64,
    pub files: Vec<CfgRuntimeFileMeta>,
    pub cfg_content: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CfgCaptureResult {
    pub captured: usize,
    pub unchanged: usize,
    pub skipped_running: bool,
    pub accounts: Vec<CfgRuntimeAccountSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TravelPlatformCred {
    pub display_name: Option<String>,
    pub login_account: Option<String>,
    pub login_password: Option<String>,
    pub remark: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TravelCfg {
    pub name: String,
    pub file_name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TravelIdentity {
    #[serde(default)]
    pub steam_account_id: String,
    pub steam_id64: String,
    pub account_name: Option<String>,
    pub persona_name: Option<String>,
    pub alias: Option<String>,
    pub remark: Option<String>,
    #[serde(default)]
    pub local_available: bool,
    pub five_e: Option<TravelPlatformCred>,
    pub perfect_world: Option<TravelPlatformCred>,
    pub cfg: Option<TravelCfg>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TravelImportResult {
    pub identity_count: usize,
    pub platform_count: usize,
    pub cfg_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ts3Identity {
    pub uuid: String,
    pub nickname: Option<String>,
    pub unique_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CfgDeployReport {
    pub game_ready: bool,
    pub written: Vec<String>,
    pub exec_command: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultReplaceResult {
    pub identities: Vec<TravelIdentity>,
    pub import: TravelImportResult,
    pub deploy: CfgDeployReport,
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
    pub installed_version: Option<String>,
    pub available_version: Option<String>,
    pub update_available: bool,
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
