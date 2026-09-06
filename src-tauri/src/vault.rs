//! 通过 CDN 上的存档服务，按 TeamSpeak Unique ID 上传和拉取外出资料。
use crate::cdn::VAULT_ARCHIVE_URL;
use crate::cs2;
use crate::error::{AppError, AppResult};
use crate::models::{CfgDeployReport, TravelIdentity};
use crate::travel;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

fn encode_id(ts3_id: &str) -> String {
    ts3_id
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_' || byte == b'.' {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Steam-Account-Manager-Vault")
        .build()
        .map_err(|_| AppError::new("VAULT_HTTP", "无法连接存档服务"))
}

fn archive_url(ts3_id: &str) -> String {
    format!("{}?id={}", VAULT_ARCHIVE_URL, encode_id(ts3_id))
}

pub fn upload_pack(ts3_id: &str, pack: &Value) -> AppResult<String> {
    let response = client()?
        .put(archive_url(ts3_id))
        .header("Content-Type", "application/json")
        .header("X-Ts3-Id", ts3_id)
        .body(
            serde_json::to_vec(pack)
                .map_err(|_| AppError::new("VAULT_SERIALIZE", "无法生成存档"))?,
        )
        .send()
        .map_err(|_| AppError::new("VAULT_HTTP", "上传存档失败"))?;
    if !response.status().is_success() {
        let message = response
            .json::<Value>()
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "上传存档被拒绝".into());
        return Err(AppError::new("VAULT_UPLOAD_REJECTED", message));
    }
    Ok(response
        .json::<Value>()
        .ok()
        .and_then(|value| {
            value
                .get("updatedAt")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default())
}

pub fn download_pack(ts3_id: &str) -> AppResult<Vec<TravelIdentity>> {
    let response = client()?
        .get(archive_url(ts3_id))
        .header("X-Ts3-Id", ts3_id)
        .send()
        .map_err(|_| AppError::new("VAULT_HTTP", "拉取存档失败"))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Err(AppError::new(
            "VAULT_NOT_FOUND",
            "该 TeamSpeak ID 还没有存档，请先在家用机上传",
        ));
    }
    if !response.status().is_success() {
        return Err(AppError::new("VAULT_DOWNLOAD_REJECTED", "拉取存档被拒绝"));
    }
    let document = response
        .json::<Value>()
        .map_err(|_| AppError::new("VAULT_JSON", "存档不是有效 JSON"))?;
    let pack = document.get("pack").cloned().unwrap_or(document);
    travel::parse_pack(&pack)
}

pub fn cfg_files(identities: &[TravelIdentity]) -> Vec<(String, String)> {
    identities
        .iter()
        .filter_map(|identity| {
            let cfg = identity.cfg.as_ref()?;
            (!cfg.content.trim().is_empty()).then(|| (cfg.file_name.clone(), cfg.content.clone()))
        })
        .collect()
}

pub fn deploy_identities(
    steam_dir: Option<&Path>,
    identities: &[TravelIdentity],
) -> CfgDeployReport {
    cs2::deploy_cfg_contents(steam_dir, &cfg_files(identities))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_plus_and_slash_in_unique_ids() {
        assert_eq!(encode_id("ab+c/d="), "ab%2Bc%2Fd%3D");
        assert_eq!(encode_id("plainID_1"), "plainID_1");
    }

    #[test]
    fn collects_non_empty_cfg_files() {
        let identities = vec![TravelIdentity {
            steam_account_id: "acc".into(),
            steam_id64: "76561198000000001".into(),
            account_name: None,
            persona_name: None,
            alias: None,
            remark: None,
            local_available: false,
            five_e: None,
            perfect_world: None,
            cfg: Some(crate::models::TravelCfg {
                name: "外出".into(),
                file_name: "travel-1.cfg".into(),
                content: "sensitivity 1\n".into(),
            }),
        }];
        assert_eq!(
            cfg_files(&identities),
            vec![("travel-1.cfg".into(), "sensitivity 1\n".into())]
        );
    }
}
