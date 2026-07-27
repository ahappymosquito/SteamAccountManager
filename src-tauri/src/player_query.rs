//! Unified player-query module with the 5E adapter, aggregation, and secure credentials.
use crate::error::{AppError, AppResult};
use crate::models::{PlatformCredentialStatus, PlayerMatch, PlayerSnapshot, PlayerStats};
use chrono::{Duration as ChronoDuration, TimeZone, Utc};
use keyring::Entry;
use reqwest::blocking::{Client, Response};
use reqwest::{StatusCode, Url};
use serde_json::{json, Value};
use std::thread;
use std::time::Duration;

const FIVE_E_ID_TRANSFER: &str =
    "https://gate.5eplay.com/userinterface/http/v1/userinterface/idTransfer";
const FIVE_E_PROFILE: &str = "https://gate.5eplay.com/userinterface/http/v1/userinterface/header";
const FIVE_E_DATA: &str = "https://gate.5eplay.com/crane/http/api/data";
const FIVE_E_SEARCH: &str = "https://arena.5eplay.com/api/search/player/1/16";
const CREDENTIAL_SERVICE: &str = "Steam Account Manager";
const CREDENTIAL_USER: &str = "5e-bearer-token";
const MATCH_LIMIT: usize = 20;

#[derive(Debug)]
struct JsonResponse {
    value: Value,
    token_expired: bool,
}

#[derive(Debug, PartialEq)]
struct ResolvedFiveEPlayer {
    domain: String,
    uuid: String,
}

#[derive(Clone)]
pub struct PlayerQuery {
    client: Client,
    id_transfer_url: String,
    search_url: String,
}

impl PlayerQuery {
    pub fn new() -> AppResult<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("SteamAccountManager/0.6.2")
            .build()
            .map_err(|_| AppError::new("PLAYER_HTTP_INIT_FAILED", "无法初始化玩家数据网络连接"))?;
        Ok(Self {
            client,
            id_transfer_url: FIVE_E_ID_TRANSFER.to_string(),
            search_url: FIVE_E_SEARCH.to_string(),
        })
    }

    pub fn query_five_e(
        &self,
        external_id: &str,
        token: Option<&str>,
    ) -> AppResult<(PlayerSnapshot, bool)> {
        let locator = external_id.trim();
        if locator.is_empty() || locator.len() > 256 {
            return Err(AppError::new(
                "PLAYER_ID_INVALID",
                "5E 玩家名称、主页链接或 ID 为空或长度无效",
            ));
        }

        let resolved = self.resolve_five_e_player(locator)?;
        let uuid = resolved.uuid;
        let domain = resolved.domain;
        let mut token_expired = false;
        let profile = self.get_json(
            Url::parse_with_params(FIVE_E_PROFILE, [("v", uuid.as_str())])
                .map_err(|_| AppError::new("PLAYER_URL_INVALID", "5E 玩家资料地址无效"))?,
            token,
        )?;
        token_expired |= profile.token_expired;

        let end = Utc::now();
        let start = end - ChronoDuration::days(180);
        let list_url = Url::parse_with_params(
            &format!("{FIVE_E_DATA}/match/list"),
            [
                ("match_type", "-1".to_string()),
                ("page", "1".to_string()),
                ("date", "0".to_string()),
                ("start_time", start.timestamp().to_string()),
                ("end_time", end.timestamp().to_string()),
                ("uuid", uuid.clone()),
                ("limit", MATCH_LIMIT.to_string()),
                ("cs_type", "0".to_string()),
            ],
        )
        .map_err(|_| AppError::new("PLAYER_URL_INVALID", "5E 比赛列表地址无效"))?;
        let list = self.get_json(list_url, token)?;
        token_expired |= list.token_expired;
        let summaries = match_list(&list.value);

        let mut matches = Vec::new();
        let mut failed_details = 0usize;
        for chunk in summaries.chunks(3) {
            let results = thread::scope(|scope| {
                let handles = chunk
                    .iter()
                    .map(|summary| {
                        scope.spawn(|| self.fetch_five_e_match(summary, &uuid, &domain, token))
                    })
                    .collect::<Vec<_>>();
                handles
                    .into_iter()
                    .map(|handle| {
                        handle.join().unwrap_or_else(|_| {
                            Err(AppError::new("PLAYER_DETAIL_FAILED", "5E 单场数据处理失败"))
                        })
                    })
                    .collect::<Vec<_>>()
            });
            for result in results {
                match result {
                    Ok((player_match, expired)) => {
                        token_expired |= expired;
                        if let Some(player_match) = player_match {
                            matches.push(player_match);
                        } else {
                            failed_details += 1;
                        }
                    }
                    Err(_) => failed_details += 1,
                }
            }
        }

        let newest = summaries.first();
        let elo_before = newest.and_then(|value| {
            value_number(
                value
                    .get("level_info")
                    .and_then(|level| level.get("origin_elo")),
            )
        });
        let elo_change = newest.and_then(|value| value_number(value.get("change_elo")));
        let elo = elo_before.map(|before| before + elo_change.unwrap_or(0.0));
        let rank_name = newest
            .and_then(|value| value.get("level_info"))
            .and_then(|level| value_text(level.get("level_name")));

        let mut warnings = Vec::new();
        if token_expired {
            warnings.push("5E Token 已失效，本次已降级为匿名查询".to_string());
        }
        if failed_details > 0 {
            warnings.push(format!(
                "{failed_details} 场比赛详情暂时不可用，汇总仅基于成功读取的数据"
            ));
        }
        if summaries.is_empty() {
            warnings.push("最近 180 天没有可用的 5E CS2 比赛".to_string());
        }

        let profile_data = profile.value.get("data").unwrap_or(&profile.value);
        let nickname = recursive_text(profile_data, &["username", "nickname"]);
        let avatar_url = recursive_text(profile_data, &["avatar_url", "avatarUrl", "rgbAvatarUrl"]);
        let stats = aggregate(&matches);
        let mut capabilities = vec![
            "player_profile".to_string(),
            "recent_matches".to_string(),
            "match_stats".to_string(),
        ];
        if elo.is_some() || rank_name.is_some() {
            capabilities.push("ladder".to_string());
        }
        if token.is_some() && !token_expired {
            capabilities.push("authenticated".to_string());
        }

        Ok((
            PlayerSnapshot {
                platform: "5e".to_string(),
                external_id: domain,
                nickname,
                avatar_url,
                rank_name,
                elo,
                elo_source: elo.map(|_| "latest_match".to_string()),
                stats,
                recent_matches: matches,
                capabilities,
                warnings,
                fetched_at: Utc::now().to_rfc3339(),
                stale: false,
            },
            token_expired,
        ))
    }

    fn resolve_five_e_player(&self, locator: &str) -> AppResult<ResolvedFiveEPlayer> {
        if let Some(domain) = domain_from_player_url(locator)? {
            return self.transfer_five_e_domain(&domain);
        }
        if locator.chars().all(|character| character.is_ascii_digit()) {
            return self.transfer_five_e_domain(locator);
        }

        let search_url = Url::parse_with_params(&self.search_url, [("keywords", locator)])
            .map_err(|_| AppError::new("PLAYER_URL_INVALID", "5E 玩家搜索地址无效"))?;
        let mut search_error = None;
        match self.get_json(search_url, None) {
            Ok(response) => {
                if let Some((domain, _username)) = select_search_player(&response.value, locator) {
                    return self.transfer_five_e_domain(&domain);
                }
            }
            Err(error) => search_error = Some(error),
        }

        match self.transfer_five_e_domain(locator) {
            Ok(resolved) => Ok(resolved),
            Err(error) if error.code != "PLAYER_NOT_FOUND" => Err(error),
            Err(_) => Err(search_error.unwrap_or_else(|| {
                AppError::new(
                    "PLAYER_NOT_FOUND",
                    "未找到名称完全匹配的 5E 玩家，请检查玩家名称、主页链接或 ID",
                )
            })),
        }
    }

    fn transfer_five_e_domain(&self, domain: &str) -> AppResult<ResolvedFiveEPlayer> {
        let response = self
            .post_json(
                Url::parse(&self.id_transfer_url)
                    .map_err(|_| AppError::new("PLAYER_URL_INVALID", "5E ID 转换地址无效"))?,
                json!({"trans": {"domain": domain}}),
                None,
            )
            .map_err(|error| {
                if error.code == "PLAYER_REMOTE_REJECTED" && error.message.contains("400") {
                    AppError::new(
                        "PLAYER_NOT_FOUND",
                        "未找到该 5E 玩家，请检查玩家名称、主页链接或 ID",
                    )
                } else {
                    error
                }
            })?;
        let uuid = response
            .value
            .get("data")
            .and_then(|data| recursive_text(data, &["uuid"]))
            .or_else(|| recursive_text(&response.value, &["uuid"]))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::new(
                    "PLAYER_NOT_FOUND",
                    "未找到该 5E 玩家，请检查玩家名称、主页链接或 ID",
                )
            })?;
        Ok(ResolvedFiveEPlayer {
            domain: domain.to_string(),
            uuid,
        })
    }

    fn fetch_five_e_match(
        &self,
        summary: &Value,
        uuid: &str,
        external_id: &str,
        token: Option<&str>,
    ) -> AppResult<(Option<PlayerMatch>, bool)> {
        let Some(match_id) = value_text(summary.get("match_id")) else {
            return Ok((None, false));
        };
        let detail = self.get_json(
            Url::parse(&format!("{FIVE_E_DATA}/match/{match_id}"))
                .map_err(|_| AppError::new("PLAYER_URL_INVALID", "5E 比赛详情地址无效"))?,
            token,
        )?;
        let detail_data = detail.value.get("data").unwrap_or(&detail.value);
        let identities = [uuid, external_id];
        let mut player = find_player(detail_data, &identities);

        let mut token_expired = detail.token_expired;
        let needs_supplement = player
            .and_then(|value| player_number(value, &["rating2", "rating"]))
            .is_none()
            || player
                .and_then(|value| player_number(value, &["adr"]))
                .is_none();
        let mut supplement = None;
        if needs_supplement && token.is_some() && !token_expired {
            for endpoint in [
                format!("{FIVE_E_DATA}/match/advanced/{match_id}"),
                format!("{FIVE_E_DATA}/match/leetify_rating/{match_id}"),
                format!("{FIVE_E_DATA}/vip_plus_match_data/{match_id}"),
            ] {
                let Ok(url) = Url::parse(&endpoint) else {
                    continue;
                };
                match self.get_json(url, token) {
                    Ok(response) => {
                        token_expired |= response.token_expired;
                        if let Some(found) = find_player(&response.value, &identities) {
                            supplement = Some(found.clone());
                            break;
                        }
                    }
                    Err(_) => continue,
                }
            }
        }
        if player.is_none() {
            player = supplement.as_ref();
        }
        let Some(player) = player else {
            return Ok((None, token_expired));
        };
        let fallback = supplement.as_ref();

        let elo_before = summary
            .get("level_info")
            .and_then(|level| value_number(level.get("origin_elo")));
        let elo_change = value_number(summary.get("change_elo"));
        let rounds = value_number(summary.get("round_total")).or_else(|| {
            value_number(
                detail_data
                    .get("main")
                    .and_then(|main| main.get("round_total")),
            )
        });
        let headshots = player_number(player, &["headshot", "headshot_kill_count"]);
        let kills = player_number(player, &["kill", "kills"]);
        let headshot_rate = match (headshots, kills) {
            (Some(headshots), Some(kills)) if kills > 0.0 => Some(headshots / kills * 100.0),
            _ => player_number(player, &["per_headshot", "headshot_rate"]).or_else(|| {
                fallback.and_then(|value| player_number(value, &["per_headshot", "headshot_rate"]))
            }),
        };

        let result = if value_bool(summary.get("is_tie")).unwrap_or(false) {
            Some("tie".to_string())
        } else {
            summary
                .get("is_win")
                .and_then(|value| value_bool(Some(value)))
                .map(|win| if win { "win" } else { "loss" }.to_string())
        };
        let score = match (
            value_text(summary.get("group1_all_score")),
            value_text(summary.get("group2_all_score")),
        ) {
            (Some(left), Some(right)) => Some(format!("{left}:{right}")),
            _ => None,
        };

        Ok((
            Some(PlayerMatch {
                match_id,
                map: value_text(summary.get("map")).or_else(|| value_text(summary.get("map_desc"))),
                occurred_at: value_number(summary.get("start_time")).and_then(timestamp),
                result,
                score,
                kills: kills.map(|value| value as i64),
                deaths: player_number(player, &["death", "deaths"]).map(|value| value as i64),
                assists: player_number(player, &["assist", "assists"]).map(|value| value as i64),
                rating: player_number(player, &["rating2", "rating"]).or_else(|| {
                    fallback.and_then(|value| player_number(value, &["rating2", "rating"]))
                }),
                adr: player_number(player, &["adr"])
                    .or_else(|| fallback.and_then(|value| player_number(value, &["adr"]))),
                headshot_rate,
                elo_before,
                elo_change,
                elo_after: elo_before.map(|value| value + elo_change.unwrap_or(0.0)),
                rounds,
            }),
            token_expired,
        ))
    }

    fn get_json(&self, url: Url, token: Option<&str>) -> AppResult<JsonResponse> {
        self.request_json(url, token, |client, url, auth| {
            let mut request = client.get(url);
            if let Some(auth) = auth {
                request = request.bearer_auth(auth);
            }
            request.send()
        })
    }

    fn post_json(&self, url: Url, body: Value, token: Option<&str>) -> AppResult<JsonResponse> {
        self.request_json(url, token, |client, url, auth| {
            let mut request = client.post(url).json(&body);
            if let Some(auth) = auth {
                request = request.bearer_auth(auth);
            }
            request.send()
        })
    }

    fn request_json(
        &self,
        url: Url,
        token: Option<&str>,
        send: impl Fn(&Client, Url, Option<&str>) -> Result<Response, reqwest::Error>,
    ) -> AppResult<JsonResponse> {
        let mut auth = token;
        let mut token_expired = false;
        let mut last_status = None;
        for attempt in 0..3 {
            match send(&self.client, url.clone(), auth) {
                Ok(response)
                    if matches!(
                        response.status(),
                        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
                    ) && auth.is_some() =>
                {
                    token_expired = true;
                    auth = None;
                    continue;
                }
                Ok(response) if response.status() == StatusCode::TOO_MANY_REQUESTS => {
                    let delay = response
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|value| value.to_str().ok())
                        .and_then(|value| value.parse::<u64>().ok())
                        .unwrap_or(1)
                        .min(5);
                    thread::sleep(Duration::from_secs(delay));
                    last_status = Some(StatusCode::TOO_MANY_REQUESTS);
                }
                Ok(response) if response.status().is_server_error() => {
                    last_status = Some(response.status());
                    thread::sleep(Duration::from_millis(250 * (attempt + 1) as u64));
                }
                Ok(response) if !response.status().is_success() => {
                    return Err(AppError::new(
                        "PLAYER_REMOTE_REJECTED",
                        format!("5E 数据服务返回 HTTP {}", response.status().as_u16()),
                    ));
                }
                Ok(response) => {
                    let value = response.json::<Value>().map_err(|_| {
                        AppError::new("PLAYER_RESPONSE_INVALID", "5E 返回了无法识别的数据格式")
                    })?;
                    return Ok(JsonResponse {
                        value,
                        token_expired,
                    });
                }
                Err(error) => {
                    if error.is_timeout() || error.is_connect() {
                        thread::sleep(Duration::from_millis(250 * (attempt + 1) as u64));
                        continue;
                    }
                    return Err(AppError::new(
                        "PLAYER_NETWORK_FAILED",
                        "无法连接 5E 数据服务",
                    ));
                }
            }
        }
        Err(AppError::new(
            if last_status == Some(StatusCode::TOO_MANY_REQUESTS) {
                "PLAYER_RATE_LIMITED"
            } else {
                "PLAYER_NETWORK_FAILED"
            },
            if last_status == Some(StatusCode::TOO_MANY_REQUESTS) {
                "5E 查询过于频繁，请稍后重试"
            } else {
                "5E 数据服务暂时不可用"
            },
        ))
    }
}

pub fn save_credential(platform_code: &str, token: Option<&str>) -> AppResult<()> {
    if platform_code != "5e" {
        return Err(AppError::new(
            "PLAYER_PLATFORM_UNSUPPORTED",
            "该平台暂不支持玩家数据凭据",
        ));
    }
    let entry = credential_entry()?;
    match token.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => entry.set_password(value).map_err(|_| {
            AppError::new(
                "CREDENTIAL_SAVE_FAILED",
                "无法将 5E Token 保存到 Windows 凭据管理器",
            )
        }),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AppError::new(
                "CREDENTIAL_DELETE_FAILED",
                "无法从 Windows 凭据管理器删除 5E Token",
            )),
        },
    }
}

pub fn load_credential(platform_code: &str) -> AppResult<Option<String>> {
    if platform_code != "5e" {
        return Ok(None);
    }
    match credential_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(AppError::new(
            "CREDENTIAL_READ_FAILED",
            "无法读取 Windows 凭据管理器中的 5E Token",
        )),
    }
}

pub fn credential_status(expired: bool) -> AppResult<PlatformCredentialStatus> {
    Ok(PlatformCredentialStatus {
        platform_code: "5e".to_string(),
        configured: load_credential("5e")?.is_some(),
        expired,
    })
}

fn credential_entry() -> AppResult<Entry> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER)
        .map_err(|_| AppError::new("CREDENTIAL_INIT_FAILED", "无法访问 Windows 凭据管理器"))
}

fn find_player<'a>(value: &'a Value, identities: &[&str]) -> Option<&'a Value> {
    match value {
        Value::Array(items) => items.iter().find_map(|item| find_player(item, identities)),
        Value::Object(map) => {
            let looks_like_player = map.contains_key("fight")
                || map.contains_key("sts")
                || ["kill", "kills", "death", "deaths", "rating", "rating2"]
                    .iter()
                    .any(|key| map.contains_key(*key));
            if looks_like_player && contains_identity(value, identities) {
                return Some(value);
            }
            map.values()
                .find_map(|child| find_player(child, identities))
        }
        _ => None,
    }
}

fn contains_identity(value: &Value, identities: &[&str]) -> bool {
    match value {
        Value::Array(items) => items.iter().any(|item| contains_identity(item, identities)),
        Value::Object(map) => {
            let identity_keys = ["uuid", "uid", "domain", "user_id", "userid"];
            identity_keys.iter().any(|key| {
                map.get(*key)
                    .and_then(|candidate| value_text(Some(candidate)))
                    .is_some_and(|candidate| {
                        identities
                            .iter()
                            .any(|identity| candidate.eq_ignore_ascii_case(identity))
                    })
            }) || map
                .values()
                .any(|child| contains_identity(child, identities))
        }
        _ => false,
    }
}

fn player_number(player: &Value, keys: &[&str]) -> Option<f64> {
    for container in [
        Some(player),
        player.get("fight"),
        player.get("sts"),
        player.get("level_info"),
    ]
    .into_iter()
    .flatten()
    {
        for key in keys {
            if let Some(value) = value_number(container.get(*key)) {
                return Some(value);
            }
        }
    }
    None
}

fn domain_from_player_url(locator: &str) -> AppResult<Option<String>> {
    if !locator.starts_with("https://") && !locator.starts_with("http://") {
        return Ok(None);
    }
    let url = Url::parse(locator)
        .map_err(|_| AppError::new("PLAYER_ID_INVALID", "5E 玩家主页链接无效"))?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host != "5eplay.com" && !host.ends_with(".5eplay.com") {
        return Err(AppError::new(
            "PLAYER_ID_INVALID",
            "请填写 5E 官方玩家主页链接",
        ));
    }
    let segments = url
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();
    let domain = segments
        .windows(2)
        .find(|pair| pair[0].eq_ignore_ascii_case("player"))
        .map(|pair| pair[1].trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("PLAYER_ID_INVALID", "5E 玩家主页链接中缺少玩家 ID"))?;
    Ok(Some(domain.to_string()))
}

fn select_search_player(value: &Value, keyword: &str) -> Option<(String, String)> {
    let users = value.pointer("/data/user/list").and_then(Value::as_array)?;
    let candidates = users
        .iter()
        .filter_map(|user| {
            let username = value_text(user.get("username"))?;
            let domain = value_text(user.get("domain"))?;
            Some((domain, username))
        })
        .collect::<Vec<_>>();
    if let Some(candidate) = candidates.iter().find(|(_, username)| username == keyword) {
        return Some(candidate.clone());
    }
    let insensitive = candidates
        .into_iter()
        .filter(|(_, username)| username.eq_ignore_ascii_case(keyword))
        .collect::<Vec<_>>();
    if insensitive.len() == 1 {
        insensitive.into_iter().next()
    } else {
        None
    }
}

fn value_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.trim().trim_end_matches('%').parse().ok(),
        _ => None,
    }
}

fn value_bool(value: Option<&Value>) -> Option<bool> {
    match value? {
        Value::Bool(value) => Some(*value),
        Value::Number(value) => value.as_i64().map(|value| value != 0),
        Value::String(value) => match value.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn value_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn match_list(value: &Value) -> Vec<Value> {
    let data = value.get("data").unwrap_or(value);
    if let Some(items) = data.as_array() {
        return items.clone();
    }
    ["list", "matches", "records", "data"]
        .iter()
        .find_map(|key| data.get(*key).and_then(Value::as_array))
        .cloned()
        .unwrap_or_default()
}

fn recursive_text(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Array(items) => items.iter().find_map(|item| recursive_text(item, keys)),
        Value::Object(map) => {
            for key in keys {
                if let Some(value) = value_text(map.get(*key)) {
                    return Some(value);
                }
            }
            map.values().find_map(|item| recursive_text(item, keys))
        }
        _ => None,
    }
}

fn timestamp(value: f64) -> Option<String> {
    let seconds = if value > 10_000_000_000.0 {
        value / 1000.0
    } else {
        value
    };
    Utc.timestamp_opt(seconds as i64, 0)
        .single()
        .map(|value| value.to_rfc3339())
}

fn aggregate(matches: &[PlayerMatch]) -> PlayerStats {
    let kills = matches.iter().filter_map(|item| item.kills).sum::<i64>();
    let deaths = matches.iter().filter_map(|item| item.deaths).sum::<i64>();
    let wins = matches
        .iter()
        .filter(|item| item.result.as_deref() == Some("win"))
        .count();
    let decided = matches
        .iter()
        .filter(|item| matches!(item.result.as_deref(), Some("win" | "loss" | "tie")))
        .count();
    let headshot_rate = if kills > 0 {
        let weighted_headshots = matches
            .iter()
            .filter_map(|item| Some(item.kills? as f64 * item.headshot_rate? / 100.0))
            .sum::<f64>();
        Some(weighted_headshots / kills as f64 * 100.0)
    } else {
        None
    };
    PlayerStats {
        sample_size: matches.len(),
        kills,
        deaths,
        kd: if deaths > 0 {
            Some(kills as f64 / deaths as f64)
        } else {
            None
        },
        rating: weighted_average(matches, |item| item.rating),
        adr: weighted_average(matches, |item| item.adr),
        headshot_rate,
        win_rate: if decided > 0 {
            Some(wins as f64 / decided as f64 * 100.0)
        } else {
            None
        },
    }
}

fn weighted_average(
    matches: &[PlayerMatch],
    field: impl Fn(&PlayerMatch) -> Option<f64>,
) -> Option<f64> {
    let values = matches
        .iter()
        .filter_map(|item| Some((field(item)?, item.rounds)))
        .collect::<Vec<_>>();
    if values.is_empty() {
        return None;
    }
    if values.iter().all(|(_, rounds)| rounds.is_some()) {
        let total_rounds = values.iter().filter_map(|(_, rounds)| *rounds).sum::<f64>();
        if total_rounds > 0.0 {
            return Some(
                values
                    .iter()
                    .map(|(value, rounds)| value * rounds.unwrap_or_default())
                    .sum::<f64>()
                    / total_rounds,
            );
        }
    }
    Some(values.iter().map(|(value, _)| value).sum::<f64>() / values.len() as f64)
}

#[cfg(test)]
mod tests {
    use super::{
        aggregate, domain_from_player_url, find_player, match_list, select_search_player,
        value_bool, PlayerQuery,
    };
    use crate::models::PlayerMatch;
    use reqwest::{blocking::Client, Url};
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc::{self, Receiver};

    fn serve(responses: Vec<&'static str>) -> (Url, Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test server");
        let address = listener.local_addr().expect("address");
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().expect("connection");
                let mut buffer = [0_u8; 4096];
                let read = stream.read(&mut buffer).expect("request");
                let _ = sender.send(String::from_utf8_lossy(&buffer[..read]).into_owned());
                stream.write_all(response.as_bytes()).expect("response");
            }
        });
        (
            Url::parse(&format!("http://{address}/data")).expect("url"),
            receiver,
        )
    }

    fn test_query() -> PlayerQuery {
        PlayerQuery {
            client: Client::builder().no_proxy().build().expect("query client"),
            id_transfer_url: super::FIVE_E_ID_TRANSFER.to_string(),
            search_url: super::FIVE_E_SEARCH.to_string(),
        }
    }

    fn match_with(
        result: &str,
        kills: i64,
        deaths: i64,
        rating: Option<f64>,
        rounds: Option<f64>,
    ) -> PlayerMatch {
        PlayerMatch {
            match_id: format!("{result}-{kills}"),
            map: None,
            occurred_at: None,
            result: Some(result.to_string()),
            score: None,
            kills: Some(kills),
            deaths: Some(deaths),
            assists: Some(0),
            rating,
            adr: rating.map(|value| value * 60.0),
            headshot_rate: Some(50.0),
            elo_before: None,
            elo_change: None,
            elo_after: None,
            rounds,
        }
    }

    #[test]
    fn aggregates_totals_rates_and_round_weighted_values() {
        let stats = aggregate(&[
            match_with("win", 20, 10, Some(1.2), Some(20.0)),
            match_with("loss", 10, 10, Some(0.8), Some(10.0)),
        ]);
        assert_eq!(stats.sample_size, 2);
        assert_eq!(stats.kills, 30);
        assert_eq!(stats.deaths, 20);
        assert_eq!(stats.kd, Some(1.5));
        assert_eq!(stats.win_rate, Some(50.0));
        assert_eq!(stats.headshot_rate, Some(50.0));
        assert!((stats.rating.unwrap_or_default() - 1.066_666_666).abs() < 0.000_001);
    }

    #[test]
    fn zero_deaths_produces_unknown_kd() {
        let stats = aggregate(&[match_with("win", 5, 0, None, None)]);
        assert_eq!(stats.kd, None);
        assert_eq!(stats.rating, None);
    }

    #[test]
    fn finds_player_by_nested_uuid() {
        let payload = json!({
            "data": {
                "group_1": [
                    {"user_info": {"user_data": {"uuid": "target"}}, "fight": {"kill": 12}}
                ]
            }
        });
        let found = find_player(&payload, &["target"]).expect("target player");
        assert_eq!(
            found
                .get("fight")
                .and_then(|fight| fight.get("kill"))
                .and_then(serde_json::Value::as_i64),
            Some(12)
        );
    }

    #[test]
    fn accepts_nested_match_lists_and_string_or_number_flags() {
        let payload = json!({"data": {"list": [{"match_id": 42}]}});
        assert_eq!(match_list(&payload)[0]["match_id"], 42);
        assert_eq!(value_bool(Some(&json!("1"))), Some(true));
        assert_eq!(value_bool(Some(&json!(0))), Some(false));
    }

    #[test]
    fn extracts_domain_from_official_player_url() {
        assert_eq!(
            domain_from_player_url("https://arena.5eplay.com/data/player/1111?from=search")
                .expect("valid URL")
                .as_deref(),
            Some("1111")
        );
        assert_eq!(domain_from_player_url("1111").expect("raw ID"), None);
        assert_eq!(
            domain_from_player_url("https://example.com/data/player/1111")
                .expect_err("foreign URL")
                .code,
            "PLAYER_ID_INVALID"
        );
    }

    #[test]
    fn selects_only_exact_or_unique_case_insensitive_player_name() {
        let payload = json!({
            "data": {"user": {"list": [
                {"username": "UniquePlayer", "domain": "1001"},
                {"username": "OtherPlayer", "domain": "1002"}
            ]}}
        });
        assert_eq!(
            select_search_player(&payload, "UniquePlayer"),
            Some(("1001".into(), "UniquePlayer".into()))
        );
        assert_eq!(
            select_search_player(&payload, "uniqueplayer"),
            Some(("1001".into(), "UniquePlayer".into()))
        );
        assert_eq!(select_search_player(&payload, "Unique"), None);
    }

    #[test]
    fn rejects_ambiguous_case_insensitive_name_matches() {
        let payload = json!({
            "data": {"user": {"list": [
                {"username": "Player", "domain": "1001"},
                {"username": "PLAYER", "domain": "1002"}
            ]}}
        });
        assert_eq!(select_search_player(&payload, "player"), None);
    }

    #[test]
    fn resolves_an_exact_player_name_through_search_and_id_transfer() {
        let (url, requests) = serve(vec![
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 66\r\nConnection: close\r\n\r\n{\"data\":{\"user\":{\"list\":[{\"username\":\"Target\",\"domain\":\"4321\"}]}}}",
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 29\r\nConnection: close\r\n\r\n{\"data\":{\"uuid\":\"uuid-4321\"}}",
        ]);
        let mut query = test_query();
        query.search_url = url.to_string();
        query.id_transfer_url = url.to_string();

        let resolved = query
            .resolve_five_e_player("Target")
            .expect("resolve exact player");

        assert_eq!(resolved.domain, "4321");
        assert_eq!(resolved.uuid, "uuid-4321");
        assert!(requests
            .recv()
            .expect("search request")
            .contains("keywords=Target"));
        assert!(requests
            .recv()
            .expect("ID transfer request")
            .contains("\"domain\":\"4321\""));
    }

    #[test]
    fn resolves_numeric_id_and_official_url_without_player_search() {
        let (url, requests) = serve(vec![
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 29\r\nConnection: close\r\n\r\n{\"data\":{\"uuid\":\"uuid-1111\"}}",
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 29\r\nConnection: close\r\n\r\n{\"data\":{\"uuid\":\"uuid-2222\"}}",
        ]);
        let mut query = test_query();
        query.id_transfer_url = url.to_string();
        query.search_url = "http://127.0.0.1:1/search".to_string();

        let numeric = query.resolve_five_e_player("1111").expect("numeric ID");
        let linked = query
            .resolve_five_e_player("https://arena.5eplay.com/data/player/2222")
            .expect("official URL");

        assert_eq!(numeric.domain, "1111");
        assert_eq!(numeric.uuid, "uuid-1111");
        assert_eq!(linked.domain, "2222");
        assert_eq!(linked.uuid, "uuid-2222");
        assert!(requests
            .recv()
            .expect("numeric transfer")
            .contains("\"domain\":\"1111\""));
        assert!(requests
            .recv()
            .expect("URL transfer")
            .contains("\"domain\":\"2222\""));
    }

    #[test]
    fn expired_token_retries_anonymously_without_exposing_it_in_the_result() {
        let (url, requests) = serve(vec![
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}",
        ]);
        let query = test_query();
        let response = query
            .request_json(url, Some("private-token"), |client, url, auth| {
                let mut request = client.get(url);
                if let Some(auth) = auth {
                    request = request.bearer_auth(auth);
                }
                request.send()
            })
            .expect("anonymous fallback");

        assert!(response.token_expired);
        assert_eq!(response.value, json!({"ok": true}));
        assert!(requests
            .recv()
            .expect("authenticated request")
            .to_ascii_lowercase()
            .contains("authorization: bearer private-token"));
        assert!(!requests
            .recv()
            .expect("anonymous request")
            .to_ascii_lowercase()
            .contains("authorization:"));
    }

    #[test]
    fn rate_limit_and_server_error_are_retried_within_the_bound() {
        let (url, _) = serve(vec![
            "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}",
        ]);
        let query = test_query();
        let response = query
            .request_json(url, None, |client, url, _| client.get(url).send())
            .expect("bounded retries");
        assert_eq!(response.value, json!({"ok": true}));
    }

    #[test]
    fn malformed_json_returns_a_stable_error_code() {
        let (url, _) = serve(vec![
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 8\r\nConnection: close\r\n\r\nnot-json",
        ]);
        let query = test_query();
        let error = query
            .request_json(url, None, |client, url, _| client.get(url).send())
            .expect_err("invalid payload");
        assert_eq!(error.code, "PLAYER_RESPONSE_INVALID");
    }
}
