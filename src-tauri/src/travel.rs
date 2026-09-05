//! 外出资料包：不依赖本机 Steam 凭证的身份卡导入导出。
use crate::error::{AppError, AppResult};
use crate::models::TravelIdentity;
use chrono::Utc;
use serde_json::{json, Value};

pub const TRAVEL_KIND: &str = "steam-account-manager-travel";

pub fn build_pack(identities: &[TravelIdentity]) -> Value {
    json!({
        "schemaVersion": 1,
        "kind": TRAVEL_KIND,
        "exportedAt": Utc::now().to_rfc3339(),
        "identities": identities,
    })
}

pub fn parse_pack(document: &Value) -> AppResult<Vec<TravelIdentity>> {
    let kind = document.get("kind").and_then(Value::as_str).unwrap_or("");
    let version = document
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if kind != TRAVEL_KIND || version != 1 {
        return Err(AppError::new(
            "TRAVEL_PACK_INVALID",
            "请选择 Steam Account Manager 外出资料包",
        ));
    }
    let identities = document
        .get("identities")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("TRAVEL_PACK_INVALID", "外出资料包缺少身份列表"))?;
    identities
        .iter()
        .map(|row| {
            serde_json::from_value::<TravelIdentity>(row.clone())
                .map_err(|_| AppError::new("TRAVEL_PACK_INVALID", "外出资料包包含无效的身份记录"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TravelCfg;

    #[test]
    fn round_trips_a_travel_pack() {
        let identities = vec![TravelIdentity {
            steam_account_id: "acc".into(),
            steam_id64: "76561198000000001".into(),
            account_name: Some("alpha".into()),
            persona_name: Some("玩家".into()),
            alias: None,
            remark: None,
            local_available: false,
            five_e: None,
            perfect_world: None,
            cfg: Some(TravelCfg {
                name: "外出配置".into(),
                file_name: "travel-1.cfg".into(),
                content: "sensitivity 1\n".into(),
            }),
        }];
        let parsed = parse_pack(&build_pack(&identities)).expect("parse");
        assert_eq!(parsed[0].steam_id64, "76561198000000001");
        assert_eq!(
            parsed[0].cfg.as_ref().map(|cfg| cfg.content.as_str()),
            Some("sensitivity 1\n")
        );
    }

    #[test]
    fn rejects_ordinary_software_backups() {
        let document = json!({"schemaVersion":2,"kind":"backup","identities":[]});
        assert_eq!(
            parse_pack(&document).expect_err("reject").code,
            "TRAVEL_PACK_INVALID"
        );
    }
}
