//! 通过 CDN 上的存档服务，按短名字和口令上传、拉取外出资料。
use crate::cdn::VAULT_ARCHIVE_URL;
use crate::cs2;
use crate::error::{AppError, AppResult};
use crate::models::{CfgDeployReport, TravelIdentity};
use crate::travel;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::StatusCode;
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

pub struct VaultLogin {
    pub name: String,
    pin: String,
}

impl std::fmt::Debug for VaultLogin {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("VaultLogin")
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

fn encode_component(value: &str) -> String {
    value
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

pub fn parse_login(name: &str, pin: &str) -> AppResult<VaultLogin> {
    let trimmed = name.trim();
    let normalized: String = trimmed
        .chars()
        .map(|character| {
            if character.is_ascii() {
                character.to_ascii_lowercase()
            } else {
                character
            }
        })
        .collect();
    let char_count = normalized.chars().count();
    if !(2..=24).contains(&char_count)
        || normalized.contains("..")
        || !normalized.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '_'
                || character == '-'
                || ('\u{4e00}'..='\u{9fff}').contains(&character)
        })
    {
        return Err(AppError::new(
            "VAULT_NAME_INVALID",
            "名字需为 2–24 个字，可用中文、字母或数字",
        ));
    }
    let pin = pin.trim();
    if !(4..=8).contains(&pin.len())
        || !pin
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err(AppError::new(
            "VAULT_PIN_INVALID",
            "口令需为 4–8 位字母或数字",
        ));
    }
    Ok(VaultLogin {
        name: normalized,
        pin: pin.to_string(),
    })
}

fn client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Steam-Account-Manager-Vault")
        .build()
        .map_err(|_| AppError::new("VAULT_HTTP", "无法连接存档服务"))
}

fn archive_url(name: &str) -> String {
    format!("{}?name={}", VAULT_ARCHIVE_URL, encode_component(name))
}

fn credential_headers(login: &VaultLogin) -> AppResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    let name = HeaderValue::from_str(&encode_component(&login.name))
        .map_err(|_| AppError::new("VAULT_NAME_INVALID", "名字包含无法发送的字符"))?;
    let pin = HeaderValue::from_str(&login.pin)
        .map_err(|_| AppError::new("VAULT_PIN_INVALID", "口令格式不对"))?;
    headers.insert("X-Vault-Name", name);
    headers.insert("X-Vault-Pin", pin);
    Ok(headers)
}

fn error_message(response: reqwest::blocking::Response, fallback: &str) -> String {
    response
        .json::<Value>()
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| fallback.into())
}

pub fn upload_pack(name: &str, pin: &str, pack: &Value) -> AppResult<String> {
    let login = parse_login(name, pin)?;
    let response = client()?
        .put(archive_url(&login.name))
        .headers(credential_headers(&login)?)
        .header("Content-Type", "application/json")
        .body(
            serde_json::to_vec(pack)
                .map_err(|_| AppError::new("VAULT_SERIALIZE", "无法生成存档"))?,
        )
        .send()
        .map_err(|_| AppError::new("VAULT_HTTP", "上传存档失败"))?;
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::new(
            "VAULT_RATE_LIMITED",
            "请求过于频繁，请稍后再试",
        ));
    }
    if !response.status().is_success() {
        return Err(AppError::new(
            "VAULT_UPLOAD_REJECTED",
            error_message(response, "上传存档被拒绝"),
        ));
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

pub fn download_pack(name: &str, pin: &str) -> AppResult<Vec<TravelIdentity>> {
    let login = parse_login(name, pin)?;
    let response = client()?
        .get(archive_url(&login.name))
        .headers(credential_headers(&login)?)
        .send()
        .map_err(|_| AppError::new("VAULT_HTTP", "拉取存档失败"))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Err(AppError::new(
            "VAULT_NOT_FOUND",
            error_message(response, "还没有这个名字的存档，请先在家用机上传"),
        ));
    }
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::new(
            "VAULT_RATE_LIMITED",
            "请求过于频繁，请稍后再试",
        ));
    }
    if !response.status().is_success() {
        return Err(AppError::new(
            "VAULT_DOWNLOAD_REJECTED",
            error_message(response, "名字或口令不对"),
        ));
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
    fn encodes_utf8_names_and_reserved_bytes() {
        assert_eq!(encode_component("ab+c/d="), "ab%2Bc%2Fd%3D");
        assert_eq!(encode_component("plainID_1"), "plainID_1");
        assert_eq!(encode_component("小明"), "%E5%B0%8F%E6%98%8E");
    }

    #[test]
    fn accepts_short_names_and_pins() {
        let login = parse_login(" 小明 ", "2468").expect("login");
        assert_eq!(login.name, "小明");
        assert_eq!(login.pin, "2468");
        assert_eq!(parse_login("Neo", "abcd").expect("ascii").name, "neo");
    }

    #[test]
    fn rejects_guessable_name_only_and_weak_pins() {
        assert_eq!(
            parse_login("a", "2468").unwrap_err().code,
            "VAULT_NAME_INVALID"
        );
        assert_eq!(
            parse_login("../x", "2468").unwrap_err().code,
            "VAULT_NAME_INVALID"
        );
        assert_eq!(
            parse_login("小明", "12").unwrap_err().code,
            "VAULT_PIN_INVALID"
        );
        assert_eq!(
            parse_login("小明", "2468 9").unwrap_err().code,
            "VAULT_PIN_INVALID"
        );
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
