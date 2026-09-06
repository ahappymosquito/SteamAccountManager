//! 从本机 TeamSpeak 3 客户端读取身份；外出存档已改用短名字和口令。
#[cfg(test)]
use crate::error::AppError;
use crate::error::AppResult;
use crate::models::Ts3Identity;
use rusqlite::Connection;
use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    time::Duration,
};

fn ts3_root() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let directory = PathBuf::from(appdata).join("TS3Client");
    directory.is_dir().then_some(directory)
}

fn printable_strings(bytes: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for &byte in bytes {
        if (32..127).contains(&byte) {
            current.push(byte as char);
        } else if !current.is_empty() {
            if current.len() >= 2 {
                out.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
        }
    }
    if current.len() >= 2 {
        out.push(current);
    }
    out
}

fn looks_like_unique_id(value: &str) -> bool {
    let trimmed = value.trim();
    (27..=32).contains(&trimmed.len())
        && trimmed.ends_with('=')
        && trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "+/=".contains(character))
}

fn looks_like_identity_blob(value: &str) -> bool {
    value.contains('V')
        && value.len() > 80
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "+/=V".contains(character))
}

pub(crate) fn parse_identities_from_db(path: &Path) -> AppResult<Vec<Ts3Identity>> {
    let connection = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )?;
    let mut statement = connection.prepare("SELECT key, value FROM ProtobufItems")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Vec<u8>>(1).unwrap_or_default(),
        ))
    })?;
    let mut identities = Vec::new();
    for row in rows {
        let (key, value) = row?;
        if key.eq_ignore_ascii_case("Checksum") {
            continue;
        }
        let strings = printable_strings(&value);
        if !strings.iter().any(|item| looks_like_identity_blob(item)) {
            continue;
        }
        let uuid = strings.iter().find(|item| {
            item.len() == 36
                && item.as_bytes().get(8) == Some(&b'-')
                && item.as_str() != "ffffffff-ffff-ffff-ffff-ffffffffffff"
        });
        let nickname = strings
            .iter()
            .rev()
            .find(|item| {
                item.chars()
                    .any(|character| character.is_ascii_alphabetic())
                    && !looks_like_identity_blob(item)
                    && !looks_like_unique_id(item)
                    && !item.contains('-')
                    && item.len() < 48
            })
            .cloned();
        let unique_id = strings
            .iter()
            .find(|item| looks_like_unique_id(item))
            .cloned();
        identities.push(Ts3Identity {
            uuid: uuid.cloned().unwrap_or(key),
            nickname,
            unique_id,
        });
    }
    Ok(identities)
}

fn clientquery_api_key(root: &Path) -> Option<String> {
    let content = fs::read_to_string(root.join("clientquery.ini")).ok()?;
    content.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        key.trim()
            .eq_ignore_ascii_case("api_key")
            .then(|| value.trim().to_string())
            .filter(|item| !item.is_empty())
    })
}

fn clientquery_whoami(api_key: &str) -> Option<String> {
    let mut stream =
        TcpStream::connect_timeout(&"127.0.0.1:25639".parse().ok()?, Duration::from_millis(400))
            .ok()?;
    stream
        .set_read_timeout(Some(Duration::from_millis(600)))
        .ok()?;
    stream
        .set_write_timeout(Some(Duration::from_millis(600)))
        .ok()?;
    let mut buffer = String::new();
    let mut bytes = [0_u8; 1024];
    if let Ok(read) = stream.read(&mut bytes) {
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
    }
    let _ = stream.write_all(format!("auth apikey={api_key}\n").as_bytes());
    if let Ok(read) = stream.read(&mut bytes) {
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
    }
    let _ = stream.write_all(b"whoami\n");
    if let Ok(read) = stream.read(&mut bytes) {
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
    }
    buffer.split_whitespace().find_map(|token| {
        token
            .strip_prefix("client_unique_identifier=")
            .map(|value| value.trim_matches('"').to_string())
            .filter(|value| looks_like_unique_id(value) || value.len() >= 8)
    })
}

pub fn list_ts3_identities() -> AppResult<Vec<Ts3Identity>> {
    let Some(root) = ts3_root() else {
        return Ok(Vec::new());
    };
    let mut identities = parse_identities_from_db(&root.join("settings.db")).unwrap_or_default();
    if let Some(api_key) = clientquery_api_key(&root) {
        if let Some(unique_id) = clientquery_whoami(&api_key) {
            if let Some(identity) = identities.iter_mut().find(|item| item.unique_id.is_none()) {
                identity.unique_id = Some(unique_id.clone());
            } else if !identities
                .iter()
                .any(|item| item.unique_id.as_deref() == Some(unique_id.as_str()))
            {
                identities.insert(
                    0,
                    Ts3Identity {
                        uuid: "clientquery".into(),
                        nickname: Some("当前 TeamSpeak 登录".into()),
                        unique_id: Some(unique_id),
                    },
                );
            }
        }
    }
    Ok(identities)
}

#[cfg(test)]
pub fn validate_ts3_id(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.len() < 8
        || trimmed.len() > 80
        || trimmed.contains("..")
        || !trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "+/=._-".contains(character))
    {
        return Err(AppError::new(
            "TS3_ID_INVALID",
            "请填写 TeamSpeak Unique ID（身份设置里可复制）",
        ));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_typical_unique_ids() {
        assert!(validate_ts3_id("IHoxfrQNl152vs80N4wYvsEmNd8=").is_ok());
        assert!(validate_ts3_id("bad id").is_err());
        assert!(validate_ts3_id("../etc/passwd").is_err());
    }

    #[test]
    fn detects_identity_blobs_and_unique_ids() {
        assert!(looks_like_identity_blob(
            "3VE5d6F2BhDo115WXcINffrGQOw8ZtH0MJAGESBAhJV2EoUUd8ckFVCitUEDJjIXJWBndiawZ6ajIhdH0GeGF9UFFcBlxNNkoBK114UhUnUSgEemAGKFZaD0AqZQVJCWsACl93YUdpMENJR2x1d3BEQ2tCb3VPUjhSOEtUR09RUWpUSUc4a1RuVE54bmkxTzBGdXpGZQ=="
        ));
        assert!(looks_like_unique_id("l/wKLOmlneDIe2kkFlHc6B0B01s="));
    }

    #[test]
    fn reads_identities_from_protobuf_items() {
        let directory = tempfile::tempdir().expect("ts3 dir");
        let path = directory.path().join("settings.db");
        let connection = Connection::open(&path).expect("sqlite");
        connection
            .execute(
                "CREATE TABLE ProtobufItems (key TEXT PRIMARY KEY, value BLOB)",
                [],
            )
            .expect("table");
        let mut blob = Vec::new();
        blob.extend_from_slice(b"ce319491-bfb8-8071-b854-4bf08d88ca24\0");
        blob.extend_from_slice(b"3VE5d6F2BhDo115WXcINffrGQOw8ZtH0MJAGESBAhJV2EoUUd8ckFVCitUEDJjIXJWBndiawZ6ajIhdH0GeGF9UFFcBlxNNkoBK114UhUnUSgEemAGKFZaD0AqZQVJCWsACl93YUdpMENJR2x1d3BEQ2tCb3VPUjhSOEtUR09RUWpUSUc4a1RuVE54bmkxTzBGdXpGZQ==\0");
        blob.extend_from_slice(b"admin\0");
        blob.extend_from_slice(b"l/wKLOmlneDIe2kkFlHc6B0B01s=\0");
        connection
            .execute(
                "INSERT INTO ProtobufItems(key, value) VALUES('Identity', ?1)",
                rusqlite::params![blob],
            )
            .expect("insert");
        let identities = parse_identities_from_db(&path).expect("parse");
        assert_eq!(identities[0].nickname.as_deref(), Some("admin"));
        assert_eq!(
            identities[0].unique_id.as_deref(),
            Some("l/wKLOmlneDIe2kkFlHc6B0B01s=")
        );
    }
}
