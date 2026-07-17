//! Loss-aware Valve KeyValues parser and span patcher for loginusers.vdf.
use crate::error::{AppError, AppResult};
use crate::models::LocalSteamAccount;

#[derive(Debug, Clone)]
enum Kind {
    Text(String),
    Open,
    Close,
}
#[derive(Debug, Clone)]
struct Token {
    kind: Kind,
    start: usize,
    end: usize,
}
#[derive(Debug, Clone)]
enum Value {
    Text {
        value: String,
        start: usize,
        end: usize,
    },
    Object(Vec<Entry>),
}
#[derive(Debug, Clone)]
struct Entry {
    key: String,
    value: Value,
}

fn tokenize(input: &str) -> AppResult<Vec<Token>> {
    let bytes = input.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b' ' | b'\t' | b'\r' | b'\n' => i += 1,
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'{' => {
                out.push(Token {
                    kind: Kind::Open,
                    start: i,
                    end: i + 1,
                });
                i += 1;
            }
            b'}' => {
                out.push(Token {
                    kind: Kind::Close,
                    start: i,
                    end: i + 1,
                });
                i += 1;
            }
            b'"' => {
                i += 1;
                let start = i;
                let mut segment_start = i;
                let mut value = String::new();
                while i < bytes.len() && bytes[i] != b'"' {
                    if bytes[i] == b'\\' && i + 1 < bytes.len() {
                        value.push_str(&input[segment_start..i]);
                        i += 1;
                        let escaped = input[i..].chars().next().ok_or_else(|| {
                            AppError::new("VDF_MALFORMED", "loginusers.vdf 包含无效转义")
                        })?;
                        value.push(match escaped {
                            'n' => '\n',
                            't' => '\t',
                            other => other,
                        });
                        i += escaped.len_utf8();
                        segment_start = i;
                    } else {
                        let character = input[i..].chars().next().ok_or_else(|| {
                            AppError::new("VDF_ENCODING", "loginusers.vdf 不是有效 UTF-8 文本")
                        })?;
                        i += character.len_utf8();
                    }
                }
                if i >= bytes.len() {
                    return Err(AppError::new(
                        "VDF_MALFORMED",
                        "loginusers.vdf 包含未结束的字符串",
                    ));
                }
                value.push_str(&input[segment_start..i]);
                out.push(Token {
                    kind: Kind::Text(value),
                    start,
                    end: i,
                });
                i += 1;
            }
            _ => {
                let start = i;
                while i < bytes.len()
                    && !bytes[i].is_ascii_whitespace()
                    && !b"{}".contains(&bytes[i])
                {
                    i += 1;
                }
                let value = input[start..i].to_string();
                out.push(Token {
                    kind: Kind::Text(value),
                    start,
                    end: i,
                });
            }
        }
    }
    Ok(out)
}

fn parse_entries(tokens: &[Token], index: &mut usize, nested: bool) -> AppResult<Vec<Entry>> {
    let mut entries = Vec::new();
    while *index < tokens.len() {
        if matches!(tokens[*index].kind, Kind::Close) {
            if !nested {
                return Err(AppError::new(
                    "VDF_MALFORMED",
                    "loginusers.vdf 存在多余的右花括号",
                ));
            }
            *index += 1;
            return Ok(entries);
        }
        let key = match &tokens[*index].kind {
            Kind::Text(v) => v.clone(),
            _ => {
                return Err(AppError::new(
                    "VDF_MALFORMED",
                    "loginusers.vdf 的键格式无效",
                ))
            }
        };
        *index += 1;
        let token = tokens
            .get(*index)
            .ok_or_else(|| AppError::new("VDF_MALFORMED", "loginusers.vdf 缺少字段值"))?;
        let value = match &token.kind {
            Kind::Text(v) => {
                *index += 1;
                Value::Text {
                    value: v.clone(),
                    start: token.start,
                    end: token.end,
                }
            }
            Kind::Open => {
                *index += 1;
                Value::Object(parse_entries(tokens, index, true)?)
            }
            Kind::Close => return Err(AppError::new("VDF_MALFORMED", "loginusers.vdf 缺少字段值")),
        };
        entries.push(Entry { key, value });
    }
    if nested {
        Err(AppError::new(
            "VDF_MALFORMED",
            "loginusers.vdf 缺少右花括号",
        ))
    } else {
        Ok(entries)
    }
}

fn root(input: &str) -> AppResult<Vec<Entry>> {
    let tokens = tokenize(input)?;
    let mut i = 0;
    parse_entries(&tokens, &mut i, false)
}
fn text<'a>(entries: &'a [Entry], key: &str) -> Option<&'a str> {
    entries
        .iter()
        .find(|e| e.key.eq_ignore_ascii_case(key))
        .and_then(|e| match &e.value {
            Value::Text { value, .. } => Some(value.as_str()),
            _ => None,
        })
}
fn users(entries: &[Entry]) -> AppResult<&[Entry]> {
    entries
        .iter()
        .find(|e| e.key.eq_ignore_ascii_case("users"))
        .and_then(|e| match &e.value {
            Value::Object(v) => Some(v.as_slice()),
            _ => None,
        })
        .ok_or_else(|| AppError::new("VDF_USERS_MISSING", "loginusers.vdf 中未找到 users 节点"))
}

pub fn parse_loginusers(input: &str) -> AppResult<Vec<LocalSteamAccount>> {
    let parsed = root(input)?;
    let mut accounts = Vec::new();
    for entry in users(&parsed)? {
        let fields = match &entry.value {
            Value::Object(v) => v,
            _ => continue,
        };
        if entry.key.parse::<u64>().is_err() {
            continue;
        }
        accounts.push(LocalSteamAccount {
            steam_id64: entry.key.clone(),
            account_name: text(fields, "AccountName").map(str::to_owned),
            persona_name: text(fields, "PersonaName").map(str::to_owned),
            remember_password: text(fields, "RememberPassword") == Some("1"),
            most_recent: text(fields, "MostRecent") == Some("1"),
            timestamp: text(fields, "Timestamp").and_then(|v| v.parse().ok()),
        });
    }
    Ok(accounts)
}

pub fn patch_most_recent(input: &str, target: &str) -> AppResult<String> {
    let parsed = root(input)?;
    let accounts = users(&parsed)?;
    if !accounts.iter().any(|e| e.key == target) {
        return Err(AppError::new(
            "ACCOUNT_NOT_LOCAL",
            "目标账号不在最新的 loginusers.vdf 中",
        ));
    }
    let mut replacements = Vec::new();
    for account in accounts {
        let fields = match &account.value {
            Value::Object(v) => v,
            _ => continue,
        };
        if let Some(Value::Text { start, end, .. }) = fields
            .iter()
            .find(|e| e.key.eq_ignore_ascii_case("MostRecent"))
            .map(|e| &e.value)
        {
            replacements.push((*start, *end, if account.key == target { "1" } else { "0" }));
        }
    }
    let mut output = input.to_string();
    for (start, end, value) in replacements.into_iter().rev() {
        output.replace_range(start..end, value);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    const BASIC: &str = "\"users\" { \"76561198000000001\" { \"AccountName\" \"alpha\" \"PersonaName\" \"A\" \"RememberPassword\" \"1\" \"MostRecent\" \"1\" \"Extra\" \"keep\" } \"76561198000000002\" { \"AccountName\" \"beta\" \"MostRecent\" \"0\" } }";
    #[test]
    fn parses_multiple_and_missing_fields() {
        let a = parse_loginusers(BASIC).expect("parse");
        assert_eq!(a.len(), 2);
        assert_eq!(a[1].persona_name, None);
    }
    #[test]
    fn patches_without_losing_unknown_fields() {
        let out = patch_most_recent(BASIC, "76561198000000002").expect("patch");
        assert!(out.contains("\"Extra\" \"keep\""));
        assert!(parse_loginusers(&out).expect("parse")[1].most_recent);
    }
    #[test]
    fn rejects_malformed() {
        assert!(parse_loginusers("\"users\" { \"x").is_err());
    }

    #[test]
    fn parses_chinese_and_mixed_account_names() {
        let input = "\"users\" { \"76561198000000003\" { \"AccountName\" \"中文账号\" \"PersonaName\" \"玩家 Alice\" \"RememberPassword\" \"1\" \"MostRecent\" \"1\" } }";
        let accounts = parse_loginusers(input).expect("parse Unicode names");
        assert_eq!(accounts[0].account_name.as_deref(), Some("中文账号"));
        assert_eq!(accounts[0].persona_name.as_deref(), Some("玩家 Alice"));
    }

    #[test]
    fn parses_escaped_text_without_corrupting_unicode() {
        let input = "\"users\" { \"76561198000000003\" { \"AccountName\" \"中文\\\"账号\" \"PersonaName\" \"第一行\\n第二行\" } }";
        let accounts = parse_loginusers(input).expect("parse escaped Unicode names");
        assert_eq!(accounts[0].account_name.as_deref(), Some("中文\"账号"));
        assert_eq!(accounts[0].persona_name.as_deref(), Some("第一行\n第二行"));
    }

    #[test]
    fn patch_preserves_unicode_content_exactly() {
        let input = "\"users\" { \"76561198000000001\" { \"PersonaName\" \"中文玩家\" \"MostRecent\" \"1\" } \"76561198000000002\" { \"PersonaName\" \"Player 二号\" \"MostRecent\" \"0\" } }";
        let output = patch_most_recent(input, "76561198000000002").expect("patch Unicode VDF");
        assert!(output.contains("\"PersonaName\" \"中文玩家\""));
        assert!(output.contains("\"PersonaName\" \"Player 二号\""));
        let accounts = parse_loginusers(&output).expect("parse patched Unicode VDF");
        assert_eq!(accounts[0].persona_name.as_deref(), Some("中文玩家"));
        assert!(accounts[1].most_recent);
    }
}
