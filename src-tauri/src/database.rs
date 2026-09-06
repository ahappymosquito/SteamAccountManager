//! SQLite migrations and transactional repositories for application data.
use crate::error::{AppError, AppResult};
use crate::models::{
    Account, AccountCfgAssignment, CfgProfile, CfgRuntimeAccountSummary, CfgRuntimeFileMeta,
    CfgRuntimeSnapshot, LocalSteamAccount, PlatformApp, PlatformLink, PlatformLinkInput,
    PlatformSummary, PlayerRankSummary, PlayerSnapshot, ProfileInput, TagOption, TravelCfg,
    TravelIdentity, TravelImportResult, TravelPlatformCred,
};
use chrono::Utc;
use parking_lot::Mutex;
use rusqlite::{
    params, params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection, OptionalExtension,
};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use uuid::Uuid;

pub struct Database(pub Mutex<Connection>);

pub struct RuntimeSnapshotInput<'a> {
    pub steam_account_id: &'a str,
    pub trigger: &'a str,
    pub source_path: &'a str,
    pub content_hash: &'a str,
    pub file_count: i64,
    pub files_json: &'a str,
    pub cfg_content: &'a str,
}

const BACKUP_TABLES: [&str; 14] = [
    "steam_accounts",
    "account_profiles",
    "tags",
    "account_tags",
    "platform_accounts",
    "account_platform_links",
    "app_settings",
    "platform_apps",
    "cfg_profiles",
    "cfg_profile_versions",
    "account_cfg_profiles",
    "account_cfg_deployments",
    "cfg_runtime_snapshots",
    "cfg_runtime_profiles",
];

fn is_optional_backup_table(table: &str) -> bool {
    matches!(table, "cfg_runtime_snapshots" | "cfg_runtime_profiles")
}

fn backup_table_rows<'a>(tables: &'a Map<String, Value>, table: &str) -> &'a [Value] {
    tables
        .get(table)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn has_column(conn: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns.iter().any(|candidate| candidate == column))
}

fn ensure_platform_credential_columns(conn: &Connection) -> AppResult<()> {
    for column in ["login_account", "login_password"] {
        if !has_column(conn, "platform_accounts", column)? {
            conn.execute(
                &format!("ALTER TABLE platform_accounts ADD COLUMN {column} TEXT"),
                [],
            )?;
        }
    }
    Ok(())
}

fn cfg_profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CfgProfile> {
    Ok(CfgProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        file_name: row.get(2)?,
        content: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        source: "manual".into(),
    })
}

fn parse_runtime_files(files_json: &str) -> Vec<CfgRuntimeFileMeta> {
    serde_json::from_str(files_json).unwrap_or_default()
}

fn table_columns(conn: &Connection, table: &str) -> AppResult<Vec<String>> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get(1))?
        .collect::<Result<_, _>>()?;
    Ok(columns)
}

fn sqlite_value_to_json(value: ValueRef<'_>) -> AppResult<Value> {
    Ok(match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => json!(value),
        ValueRef::Real(value) => json!(value),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(_) => {
            return Err(AppError::new(
                "BACKUP_UNSUPPORTED_VALUE",
                "业务数据包含无法导出的二进制字段",
            ))
        }
    })
}

fn json_value_to_sql(value: &Value) -> AppResult<SqlValue> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(value) => Ok(SqlValue::Integer(i64::from(*value))),
        Value::Number(value) if value.is_i64() => {
            Ok(SqlValue::Integer(value.as_i64().expect("checked integer")))
        }
        Value::Number(value) if value.is_u64() => {
            let value = value
                .as_u64()
                .and_then(|value| i64::try_from(value).ok())
                .ok_or_else(|| AppError::new("BACKUP_INVALID", "备份文件包含超范围整数"))?;
            Ok(SqlValue::Integer(value))
        }
        Value::Number(value) => {
            Ok(SqlValue::Real(value.as_f64().ok_or_else(|| {
                AppError::new("BACKUP_INVALID", "备份文件包含无效数字")
            })?))
        }
        Value::String(value) => Ok(SqlValue::Text(value.clone())),
        _ => Err(AppError::new(
            "BACKUP_INVALID",
            "备份记录字段只能是文本、数字、布尔值或空值",
        )),
    }
}

fn dump_table(conn: &Connection, table: &str) -> AppResult<Value> {
    let columns = table_columns(conn, table)?;
    let where_clause = if table == "app_settings" {
        " WHERE key NOT LIKE 'credential.%'"
    } else {
        ""
    };
    let mut statement = conn.prepare(&format!("SELECT * FROM {table}{where_clause}"))?;
    let rows = statement.query_map([], |row| {
        let mut object = Map::new();
        for (index, column) in columns.iter().enumerate() {
            object.insert(
                column.clone(),
                sqlite_value_to_json(row.get_ref(index)?)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
            );
        }
        Ok(Value::Object(object))
    })?;
    Ok(Value::Array(rows.collect::<Result<_, _>>()?))
}

fn backup_document(conn: &Connection) -> AppResult<Value> {
    let mut tables = Map::new();
    for table in BACKUP_TABLES {
        tables.insert(table.to_string(), dump_table(conn, table)?);
    }
    Ok(json!({
        "schemaVersion": 2,
        "exportedAt": Utc::now().to_rfc3339(),
        "tables": tables,
    }))
}

fn backup_tables(document: &Value) -> AppResult<&Map<String, Value>> {
    if document.get("schemaVersion").and_then(Value::as_u64) != Some(2) {
        return Err(AppError::new(
            "BACKUP_VERSION_UNSUPPORTED",
            "仅支持版本 2 的 Steam Account Manager 备份文件",
        ));
    }
    let tables = document
        .get("tables")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::new("BACKUP_INVALID", "备份文件缺少 tables 对象"))?;
    for table in BACKUP_TABLES {
        match tables.get(table) {
            Some(value) if value.is_array() => {}
            None if is_optional_backup_table(table) => {}
            _ => {
                return Err(AppError::new(
                    "BACKUP_INVALID",
                    format!("备份文件缺少 {table} 数据"),
                ));
            }
        }
    }
    Ok(tables)
}

fn insert_backup_table(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    allowed_columns: &[String],
    records: &[Value],
) -> AppResult<()> {
    for record in records {
        let object = record
            .as_object()
            .ok_or_else(|| AppError::new("BACKUP_INVALID", "备份表记录必须是对象"))?;
        if object
            .keys()
            .any(|column| !allowed_columns.iter().any(|allowed| allowed == column))
        {
            return Err(AppError::new(
                "BACKUP_INVALID",
                format!("备份文件的 {table} 表包含未知字段"),
            ));
        }
        if table == "app_settings"
            && object
                .get("key")
                .and_then(Value::as_str)
                .is_some_and(|key| key.starts_with("credential."))
        {
            return Err(AppError::new(
                "BACKUP_INVALID",
                "备份文件不得包含平台查询 Token 状态",
            ));
        }
        let columns: Vec<_> = allowed_columns
            .iter()
            .filter(|column| object.contains_key(column.as_str()))
            .collect();
        if columns.is_empty() {
            return Err(AppError::new("BACKUP_INVALID", "备份记录不包含可恢复字段"));
        }
        let placeholders = (1..=columns.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "INSERT INTO {table}({}) VALUES({placeholders})",
            columns
                .iter()
                .map(|column| column.as_str())
                .collect::<Vec<_>>()
                .join(",")
        );
        let values = columns
            .iter()
            .map(|column| json_value_to_sql(&object[column.as_str()]))
            .collect::<AppResult<Vec<_>>>()?;
        tx.execute(&sql, params_from_iter(values))?;
    }
    Ok(())
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let tx = conn.transaction()?;
        tx.execute_batch(include_str!("../migrations/001_init.sql"))?;
        tx.commit()?;
        ensure_platform_credential_columns(&conn)?;
        let database = Self(Mutex::new(conn));
        database.ensure_active_cfg_profile()?;
        Ok(database)
    }

    pub fn export_backup(&self) -> AppResult<Value> {
        backup_document(&self.0.lock())
    }

    pub fn preview_backup(document: &Value) -> AppResult<crate::models::ImportPreview> {
        let tables = backup_tables(document)?;
        let count = |table: &str| {
            tables
                .get(table)
                .and_then(Value::as_array)
                .map_or(0, Vec::len)
        };
        Ok(crate::models::ImportPreview {
            schema_version: 2,
            exported_at: document
                .get("exportedAt")
                .and_then(Value::as_str)
                .unwrap_or("未知时间")
                .to_string(),
            account_count: count("steam_accounts"),
            platform_link_count: count("account_platform_links"),
            cfg_profile_count: count("cfg_profiles"),
            matched_account_count: count("steam_accounts"),
            skipped_account_count: 0,
            matched_platform_link_count: count("account_platform_links"),
            setting_count: count("app_settings") + count("platform_apps"),
        })
    }

    pub fn preview_backup_for_restore(
        &self,
        document: &Value,
    ) -> AppResult<crate::models::ImportPreview> {
        let mut preview = Self::preview_backup(document)?;
        let tables = backup_tables(document)?;
        let conn = self.0.lock();
        let mut local =
            conn.prepare("SELECT id,steam_id64 FROM steam_accounts WHERE local_available=1")?;
        let local_by_steam: HashMap<String, String> = local
            .query_map([], |row| Ok((row.get(1)?, row.get(0)?)))?
            .collect::<Result<_, _>>()?;
        let imported_accounts = tables["steam_accounts"]
            .as_array()
            .expect("validated accounts");
        let matched_ids: HashSet<String> = imported_accounts
            .iter()
            .filter_map(|row| {
                let object = row.as_object()?;
                local_by_steam
                    .contains_key(object.get("steam_id64")?.as_str()?)
                    .then(|| object.get("id")?.as_str().map(str::to_string))
                    .flatten()
            })
            .collect();
        preview.matched_account_count = matched_ids.len();
        preview.skipped_account_count = preview.account_count - preview.matched_account_count;
        preview.matched_platform_link_count = tables["account_platform_links"]
            .as_array()
            .expect("validated links")
            .iter()
            .filter(|row| {
                row.get("steam_account_id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| matched_ids.contains(id))
            })
            .count();
        Ok(preview)
    }

    pub fn restore_backup_selected(
        &self,
        document: &Value,
        selection: crate::models::RestoreSelection,
    ) -> AppResult<crate::models::ImportPreview> {
        let preview = self.preview_backup_for_restore(document)?;
        if !selection.accounts && !selection.cfg && !selection.settings {
            return Err(AppError::new(
                "BACKUP_SELECTION_EMPTY",
                "请至少选择一类资料",
            ));
        }
        let imported = backup_tables(document)?;
        let mut merged = self.export_backup()?;
        let current = merged["tables"]
            .as_object_mut()
            .expect("current backup tables");
        let current_accounts = current["steam_accounts"]
            .as_array()
            .expect("current accounts");
        let local_by_steam: HashMap<String, String> = current_accounts
            .iter()
            .filter(|row| row.get("local_available").and_then(Value::as_i64) == Some(1))
            .filter_map(|row| {
                Some((
                    row.get("steam_id64")?.as_str()?.to_string(),
                    row.get("id")?.as_str()?.to_string(),
                ))
            })
            .collect();
        let account_mapping: HashMap<String, String> = imported["steam_accounts"]
            .as_array()
            .expect("imported accounts")
            .iter()
            .filter_map(|row| {
                Some((
                    row.get("id")?.as_str()?.to_string(),
                    local_by_steam
                        .get(row.get("steam_id64")?.as_str()?)?
                        .clone(),
                ))
            })
            .collect();
        let matched_local: HashSet<String> = account_mapping.values().cloned().collect();
        let remap_account_rows = |table: &str| {
            backup_table_rows(imported, table)
                .iter()
                .filter_map(|row| {
                    let mut row = row.as_object()?.clone();
                    let local_id = account_mapping.get(row.get("steam_account_id")?.as_str()?)?;
                    row.insert("steam_account_id".into(), Value::String(local_id.clone()));
                    Some(Value::Object(row))
                })
                .collect::<Vec<_>>()
        };

        if selection.accounts {
            let mut profiles = current["account_profiles"]
                .as_array()
                .expect("current profiles")
                .iter()
                .filter(|row| {
                    row.get("steam_account_id")
                        .and_then(Value::as_str)
                        .is_none_or(|id| !matched_local.contains(id))
                })
                .cloned()
                .collect::<Vec<_>>();
            profiles.extend(remap_account_rows("account_profiles"));
            current.insert("account_profiles".into(), Value::Array(profiles));

            let mut tags = current["tags"].as_array().expect("current tags").clone();
            let mut tag_by_name: HashMap<String, String> = tags
                .iter()
                .filter_map(|row| {
                    Some((
                        row.get("name")?.as_str()?.to_lowercase(),
                        row.get("id")?.as_str()?.to_string(),
                    ))
                })
                .collect();
            let imported_tags: HashMap<String, &Value> = imported["tags"]
                .as_array()
                .expect("imported tags")
                .iter()
                .filter_map(|row| Some((row.get("id")?.as_str()?.to_string(), row)))
                .collect();
            let mut account_tags = current["account_tags"]
                .as_array()
                .expect("current account tags")
                .iter()
                .filter(|row| {
                    row.get("steam_account_id")
                        .and_then(Value::as_str)
                        .is_none_or(|id| !matched_local.contains(id))
                })
                .cloned()
                .collect::<Vec<_>>();
            for row in imported["account_tags"]
                .as_array()
                .expect("imported account tags")
            {
                let Some(local_id) = row
                    .get("steam_account_id")
                    .and_then(Value::as_str)
                    .and_then(|id| account_mapping.get(id))
                else {
                    continue;
                };
                let imported_tag_id = row
                    .get("tag_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::new("BACKUP_INVALID", "标签关联缺少 tag_id"))?;
                let tag = imported_tags
                    .get(imported_tag_id)
                    .ok_or_else(|| AppError::new("BACKUP_INVALID", "标签关联引用不存在"))?;
                let name = tag["name"]
                    .as_str()
                    .ok_or_else(|| AppError::new("BACKUP_INVALID", "标签名称无效"))?;
                let actual_tag_id = if let Some(id) = tag_by_name.get(&name.to_lowercase()) {
                    id.clone()
                } else {
                    let id = Uuid::new_v4().to_string();
                    let mut created = tag.as_object().expect("tag object").clone();
                    created.insert("id".into(), Value::String(id.clone()));
                    tags.push(Value::Object(created));
                    tag_by_name.insert(name.to_lowercase(), id.clone());
                    id
                };
                account_tags.push(json!({
                    "steam_account_id": local_id,
                    "tag_id": actual_tag_id,
                }));
            }
            current.insert("tags".into(), Value::Array(tags));
            current.insert("account_tags".into(), Value::Array(account_tags));

            let retained_links = current["account_platform_links"]
                .as_array()
                .expect("current platform links")
                .iter()
                .filter(|row| {
                    row.get("steam_account_id")
                        .and_then(Value::as_str)
                        .is_none_or(|id| !matched_local.contains(id))
                })
                .cloned()
                .collect::<Vec<_>>();
            let retained_platform_ids: HashSet<String> = retained_links
                .iter()
                .filter_map(|row| row.get("platform_account_id")?.as_str().map(str::to_string))
                .collect();
            let imported_platforms: HashMap<String, &Value> = imported["platform_accounts"]
                .as_array()
                .expect("imported platforms")
                .iter()
                .filter_map(|row| Some((row.get("id")?.as_str()?.to_string(), row)))
                .collect();
            let mut platform_accounts = current["platform_accounts"]
                .as_array()
                .expect("current platform accounts")
                .iter()
                .filter(|row| {
                    row.get("id")
                        .and_then(Value::as_str)
                        .is_some_and(|id| retained_platform_ids.contains(id))
                })
                .cloned()
                .collect::<Vec<_>>();
            let mut platform_links = retained_links;
            for row in imported["account_platform_links"]
                .as_array()
                .expect("imported platform links")
            {
                let Some(local_id) = row
                    .get("steam_account_id")
                    .and_then(Value::as_str)
                    .and_then(|id| account_mapping.get(id))
                else {
                    continue;
                };
                let imported_platform_id = row["platform_account_id"]
                    .as_str()
                    .ok_or_else(|| AppError::new("BACKUP_INVALID", "平台关联无效"))?;
                let platform = imported_platforms
                    .get(imported_platform_id)
                    .ok_or_else(|| AppError::new("BACKUP_INVALID", "平台账号引用不存在"))?;
                let platform_id = Uuid::new_v4().to_string();
                let mut platform = platform.as_object().expect("platform object").clone();
                platform.insert("id".into(), Value::String(platform_id.clone()));
                platform_accounts.push(Value::Object(platform));
                let mut link = row.as_object().expect("link object").clone();
                link.insert("id".into(), Value::String(Uuid::new_v4().to_string()));
                link.insert("steam_account_id".into(), Value::String(local_id.clone()));
                link.insert("platform_account_id".into(), Value::String(platform_id));
                platform_links.push(Value::Object(link));
            }
            current.insert("platform_accounts".into(), Value::Array(platform_accounts));
            current.insert(
                "account_platform_links".into(),
                Value::Array(platform_links),
            );
        }

        if selection.cfg {
            for table in ["cfg_profiles", "cfg_profile_versions"] {
                current.insert(
                    table.into(),
                    Value::Array(backup_table_rows(imported, table).to_vec()),
                );
            }
            current.insert(
                "account_cfg_profiles".into(),
                Value::Array(remap_account_rows("account_cfg_profiles")),
            );
            current.insert(
                "account_cfg_deployments".into(),
                Value::Array(remap_account_rows("account_cfg_deployments")),
            );
            current.insert(
                "cfg_runtime_snapshots".into(),
                Value::Array(remap_account_rows("cfg_runtime_snapshots")),
            );
            let profile_ids: HashSet<String> = backup_table_rows(imported, "cfg_profiles")
                .iter()
                .filter_map(|row| row.get("id")?.as_str().map(str::to_string))
                .collect();
            current.insert(
                "cfg_runtime_profiles".into(),
                Value::Array(
                    remap_account_rows("cfg_runtime_profiles")
                        .into_iter()
                        .filter(|row| {
                            row.get("profile_id")
                                .and_then(Value::as_str)
                                .is_some_and(|id| profile_ids.contains(id))
                        })
                        .collect(),
                ),
            );
        }
        if selection.settings {
            current.insert("app_settings".into(), imported["app_settings"].clone());
            current.insert("platform_apps".into(), imported["platform_apps"].clone());
        }
        self.restore_backup(&merged)?;
        Ok(preview)
    }

    pub fn restore_backup(&self, document: &Value) -> AppResult<crate::models::ImportPreview> {
        let preview = Self::preview_backup(document)?;
        let tables = backup_tables(document)?;
        let mut conn = self.0.lock();
        let columns = BACKUP_TABLES
            .iter()
            .map(|table| Ok((*table, table_columns(&conn, table)?)))
            .collect::<AppResult<Vec<_>>>()?;
        let tx = conn.transaction()?;
        tx.pragma_update(None, "defer_foreign_keys", "ON")?;
        tx.execute_batch(
            "DELETE FROM switch_logs;
             DELETE FROM player_snapshot_cache;
             DELETE FROM cfg_runtime_profiles;
             DELETE FROM cfg_runtime_snapshots;
             DELETE FROM account_cfg_deployments;
             DELETE FROM account_cfg_profiles;
             DELETE FROM cfg_profile_versions;
             DELETE FROM cfg_profiles;
             DELETE FROM account_platform_links;
             DELETE FROM platform_accounts;
             DELETE FROM account_tags;
             DELETE FROM tags;
             DELETE FROM account_profiles;
             DELETE FROM steam_accounts;
             DELETE FROM platform_apps;
             DELETE FROM app_settings WHERE key NOT LIKE 'credential.%';",
        )?;
        for (table, allowed_columns) in columns {
            insert_backup_table(
                &tx,
                table,
                &allowed_columns,
                backup_table_rows(tables, table),
            )?;
        }
        tx.commit()?;
        drop(conn);
        self.ensure_active_cfg_profile()?;
        Ok(preview)
    }

    pub fn sync_accounts(&self, incoming: &[LocalSteamAccount]) -> AppResult<usize> {
        let mut conn = self.0.lock();
        let tx = conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE steam_accounts SET local_available=0, updated_at=?1",
            params![now],
        )?;
        for account in incoming {
            let id: Option<String> = tx
                .query_row(
                    "SELECT id FROM steam_accounts WHERE steam_id64=?1",
                    [&account.steam_id64],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(id) = id {
                tx.execute("UPDATE steam_accounts SET account_name=?1,persona_name=?2,local_available=1,last_local_seen_at=?3,updated_at=?3 WHERE id=?4", params![account.account_name, account.persona_name, now, id])?;
            } else {
                let id = Uuid::new_v4().to_string();
                tx.execute("INSERT INTO steam_accounts(id,steam_id64,account_name,persona_name,local_available,last_local_seen_at,created_at,updated_at) VALUES(?1,?2,?3,?4,1,?5,?5,?5)", params![id, account.steam_id64, account.account_name, account.persona_name, now])?;
                tx.execute(
                    "INSERT INTO account_profiles(steam_account_id) VALUES(?1)",
                    [id],
                )?;
            }
        }
        tx.commit()?;
        Ok(incoming.len())
    }

    pub fn list_accounts(&self) -> AppResult<Vec<Account>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare("SELECT a.id,a.steam_id64,a.account_name,a.persona_name,a.last_local_seen_at,a.last_switched_at,a.created_at,a.updated_at,p.alias,p.remark,p.group_name,p.favorite,a.local_available FROM steam_accounts a LEFT JOIN account_profiles p ON p.steam_account_id=a.id ORDER BY a.local_available DESC,p.favorite DESC,COALESCE(a.last_switched_at,a.created_at) DESC")?;
        let rows = stmt.query_map([], |r| {
            Ok(Account {
                id: r.get(0)?,
                steam_id64: r.get(1)?,
                account_name: r.get(2)?,
                persona_name: r.get(3)?,
                last_local_seen_at: r.get(4)?,
                last_switched_at: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
                alias: r.get(8)?,
                remark: r.get(9)?,
                group_name: r.get(10)?,
                favorite: r.get::<_, Option<i64>>(11)?.unwrap_or(0) != 0,
                tags: Vec::new(),
                platform_codes: Vec::new(),
                platform_summaries: Vec::new(),
                player_ranks: Vec::new(),
                avatar_path: None,
                avatar_version: None,
                avatar_frame_path: None,
                avatar_frame_version: None,
                local_available: r.get::<_, i64>(12)? != 0,
            })
        })?;
        let mut accounts: Vec<Account> = rows.collect::<Result<_, _>>()?;
        for account in &mut accounts {
            let mut tags = conn.prepare("SELECT t.name FROM tags t JOIN account_tags at ON at.tag_id=t.id WHERE at.steam_account_id=?1 ORDER BY t.name")?;
            account.tags = tags
                .query_map([&account.id], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            let mut platforms = conn.prepare("SELECT DISTINCT p.platform_code FROM platform_accounts p JOIN account_platform_links l ON l.platform_account_id=p.id WHERE l.steam_account_id=?1 ORDER BY p.platform_code")?;
            account.platform_codes = platforms
                .query_map([&account.id], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            let mut summaries = conn.prepare(
                "SELECT p.platform_code,p.display_name,p.external_id,p.status
                 FROM platform_accounts p
                 JOIN account_platform_links l ON l.platform_account_id=p.id
                 WHERE l.steam_account_id=?1
                 ORDER BY p.platform_code",
            )?;
            account.platform_summaries = summaries
                .query_map([&account.id], |row| {
                    Ok(PlatformSummary {
                        platform_code: row.get(0)?,
                        display_name: row.get(1)?,
                        external_id: row.get(2)?,
                        status: row.get(3)?,
                    })
                })?
                .collect::<Result<_, _>>()?;
            let mut ranks = conn.prepare(
                "SELECT p.platform_code,c.snapshot_json,c.expires_at
                 FROM account_platform_links l
                 JOIN platform_accounts p ON p.id=l.platform_account_id
                 JOIN player_snapshot_cache c ON c.platform_link_id=l.id
                 WHERE l.steam_account_id=?1
                 ORDER BY p.platform_code",
            )?;
            account.player_ranks = ranks
                .query_map([&account.id], |row| {
                    let platform: String = row.get(0)?;
                    let payload: String = row.get(1)?;
                    let expires_at: String = row.get(2)?;
                    let snapshot = serde_json::from_str::<PlayerSnapshot>(&payload).ok();
                    Ok(snapshot.map(|snapshot| PlayerRankSummary {
                        platform,
                        rank_name: snapshot.rank_name,
                        score: snapshot.elo,
                        score_source: snapshot.elo_source,
                        ranking_state: snapshot.ranking_state,
                        placement_matches: snapshot.placement_matches,
                        previous_season_score: snapshot.previous_season_score,
                        stale: snapshot.stale
                            || chrono::DateTime::parse_from_rfc3339(&expires_at)
                                .is_ok_and(|expires| expires <= Utc::now()),
                    }))
                })?
                .filter_map(|result| result.transpose())
                .collect::<Result<_, _>>()?;
        }
        Ok(accounts)
    }

    pub fn account_identity(
        &self,
        account_id: &str,
    ) -> AppResult<Option<(String, Option<String>)>> {
        Ok(self
            .0
            .lock()
            .query_row(
                "SELECT steam_id64,persona_name FROM steam_accounts WHERE id=?1",
                [account_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    pub fn list_tags(&self) -> AppResult<Vec<TagOption>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare("SELECT t.name,COUNT(at.steam_account_id) AS usage_count FROM tags t LEFT JOIN account_tags at ON at.tag_id=t.id GROUP BY t.id,t.name ORDER BY usage_count DESC,t.name COLLATE NOCASE")?;
        let tags = stmt
            .query_map([], |row| {
                Ok(TagOption {
                    name: row.get(0)?,
                    usage_count: row.get::<_, i64>(1)? as usize,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(tags)
    }

    pub fn save_profile(&self, input: &ProfileInput) -> AppResult<()> {
        let mut conn = self.0.lock();
        let tx = conn.transaction()?;
        let exists = tx
            .query_row(
                "SELECT 1 FROM steam_accounts WHERE id=?1",
                [&input.account_id],
                |_| Ok(()),
            )
            .optional()?;
        if exists.is_none() {
            return Err(AppError::new(
                "ACCOUNT_NOT_FOUND",
                "只能更新已由 Steam 扫描到的账号",
            ));
        }
        let now = Utc::now().to_rfc3339();
        tx.execute("INSERT INTO account_profiles(steam_account_id,alias,remark,favorite) VALUES(?1,?2,?3,?4) ON CONFLICT(steam_account_id) DO UPDATE SET alias=excluded.alias,remark=excluded.remark,favorite=excluded.favorite",params![input.account_id,input.alias,input.remark,input.favorite as i64])?;
        tx.execute(
            "UPDATE steam_accounts SET updated_at=?1 WHERE id=?2",
            params![now, input.account_id],
        )?;
        tx.execute(
            "DELETE FROM account_tags WHERE steam_account_id=?1",
            [&input.account_id],
        )?;
        for name in input
            .tags
            .iter()
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
        {
            let existing = tx
                .query_row(
                    "SELECT id FROM tags WHERE name=?1 COLLATE NOCASE LIMIT 1",
                    [name],
                    |r| r.get::<_, String>(0),
                )
                .optional()?;
            let actual = if let Some(id) = existing {
                id
            } else {
                let tag_id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO tags(id,name,created_at) VALUES(?1,?2,?3)",
                    params![tag_id, name, now],
                )?;
                tag_id
            };
            tx.execute(
                "INSERT OR IGNORE INTO account_tags(steam_account_id,tag_id) VALUES(?1,?2)",
                params![input.account_id, actual],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn account_id_by_steam_id(&self, steam_id64: &str) -> AppResult<Option<String>> {
        Ok(self
            .0
            .lock()
            .query_row(
                "SELECT id FROM steam_accounts WHERE steam_id64=?1",
                [steam_id64],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn list_links(&self, steam_account_id: &str) -> AppResult<Vec<PlatformLink>> {
        let conn = self.0.lock();
        let mut stmt=conn.prepare("SELECT l.id,l.steam_account_id,p.platform_code,p.external_id,p.display_name,p.profile_url,p.login_account,p.login_password,p.remark,p.status,p.last_verified_at FROM account_platform_links l JOIN platform_accounts p ON p.id=l.platform_account_id WHERE l.steam_account_id=?1 ORDER BY p.platform_code")?;
        let links = stmt
            .query_map([steam_account_id], |r| {
                Ok(PlatformLink {
                    id: r.get(0)?,
                    steam_account_id: r.get(1)?,
                    platform_code: r.get(2)?,
                    external_id: r.get(3)?,
                    display_name: r.get(4)?,
                    profile_url: r.get(5)?,
                    login_account: r.get(6)?,
                    login_password: r.get(7)?,
                    remark: r.get(8)?,
                    status: r.get(9)?,
                    last_verified_at: r.get(10)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(links)
    }

    pub fn refreshable_five_e_links(&self) -> AppResult<Vec<PlatformLink>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare(
            "SELECT l.id,l.steam_account_id,p.platform_code,p.external_id,p.display_name,p.profile_url,p.login_account,p.login_password,p.remark,p.status,p.last_verified_at
             FROM account_platform_links l
             JOIN platform_accounts p ON p.id=l.platform_account_id
             WHERE p.platform_code='5e' AND TRIM(COALESCE(p.external_id,''))<>''
             ORDER BY l.id",
        )?;
        let links = stmt
            .query_map([], |row| {
                Ok(PlatformLink {
                    id: row.get(0)?,
                    steam_account_id: row.get(1)?,
                    platform_code: row.get(2)?,
                    external_id: row.get(3)?,
                    display_name: row.get(4)?,
                    profile_url: row.get(5)?,
                    login_account: row.get(6)?,
                    login_password: row.get(7)?,
                    remark: row.get(8)?,
                    status: row.get(9)?,
                    last_verified_at: row.get(10)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(links)
    }

    pub fn save_link(&self, input: &PlatformLinkInput) -> AppResult<()> {
        if !["perfectworld", "5e", "faceit", "other"].contains(&input.platform_code.as_str()) {
            return Err(AppError::new("INVALID_PLATFORM", "不支持的平台类型"));
        }
        if !["unverified", "user_confirmed", "invalid"].contains(&input.status.as_str()) {
            return Err(AppError::new("INVALID_STATUS", "关联状态无效"));
        }
        if let Some(url) = input
            .profile_url
            .as_deref()
            .filter(|v| !v.trim().is_empty())
        {
            let parsed = url::Url::parse(url)
                .map_err(|_| AppError::new("INVALID_URL", "个人主页地址无效"))?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err(AppError::new(
                    "INVALID_URL_SCHEME",
                    "个人主页只允许 http 或 https",
                ));
            }
        }
        let mut conn = self.0.lock();
        let tx = conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        let link_id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let previous_identity: Option<(String, Option<String>)> = tx
            .query_row(
                "SELECT p.platform_code,p.external_id FROM account_platform_links l JOIN platform_accounts p ON p.id=l.platform_account_id WHERE l.id=?1",
                [&link_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let platform_id: Option<String> = tx
            .query_row(
                "SELECT platform_account_id FROM account_platform_links WHERE id=?1",
                [&link_id],
                |r| r.get(0),
            )
            .optional()?;
        let platform_id = platform_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        tx.execute("INSERT INTO platform_accounts(id,platform_code,external_id,display_name,profile_url,login_account,login_password,remark,status,binding_method,last_verified_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'manual',CASE WHEN ?9='user_confirmed' THEN ?10 ELSE NULL END,?10,?10) ON CONFLICT(id) DO UPDATE SET platform_code=excluded.platform_code,external_id=excluded.external_id,display_name=excluded.display_name,profile_url=excluded.profile_url,login_account=excluded.login_account,login_password=excluded.login_password,remark=excluded.remark,status=excluded.status,last_verified_at=CASE WHEN excluded.status='user_confirmed' THEN excluded.updated_at ELSE platform_accounts.last_verified_at END,updated_at=excluded.updated_at",params![platform_id,input.platform_code,input.external_id,input.display_name,input.profile_url,input.login_account,input.login_password,input.remark,input.status,now])?;
        tx.execute("INSERT INTO account_platform_links(id,steam_account_id,platform_account_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?4) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at",params![link_id,input.steam_account_id,platform_id,now])?;
        let normalize = |value: Option<&str>| {
            value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        let identity_changed = previous_identity.is_some_and(|(platform_code, external_id)| {
            platform_code != input.platform_code
                || normalize(external_id.as_deref()) != normalize(input.external_id.as_deref())
        });
        if identity_changed {
            tx.execute(
                "DELETE FROM player_snapshot_cache WHERE platform_link_id=?1",
                [&link_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn delete_link(&self, id: &str) -> AppResult<()> {
        let mut c = self.0.lock();
        let tx = c.transaction()?;
        let pid: Option<String> = tx
            .query_row(
                "SELECT platform_account_id FROM account_platform_links WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        tx.execute("DELETE FROM account_platform_links WHERE id=?1", [id])?;
        if let Some(pid) = pid {
            tx.execute("DELETE FROM platform_accounts WHERE id=?1", [pid])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn platform_link(&self, id: &str) -> AppResult<Option<PlatformLink>> {
        let conn = self.0.lock();
        Ok(conn
            .query_row(
                "SELECT l.id,l.steam_account_id,p.platform_code,p.external_id,p.display_name,p.profile_url,p.login_account,p.login_password,p.remark,p.status,p.last_verified_at FROM account_platform_links l JOIN platform_accounts p ON p.id=l.platform_account_id WHERE l.id=?1",
                [id],
                |r| {
                    Ok(PlatformLink {
                        id: r.get(0)?,
                        steam_account_id: r.get(1)?,
                        platform_code: r.get(2)?,
                        external_id: r.get(3)?,
                        display_name: r.get(4)?,
                        profile_url: r.get(5)?,
                        login_account: r.get(6)?,
                        login_password: r.get(7)?,
                        remark: r.get(8)?,
                        status: r.get(9)?,
                        last_verified_at: r.get(10)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn player_snapshot_cache(
        &self,
        platform_link_id: &str,
    ) -> AppResult<Option<(String, String)>> {
        let conn = self.0.lock();
        Ok(conn
            .query_row(
                "SELECT snapshot_json,expires_at FROM player_snapshot_cache WHERE platform_link_id=?1",
                [platform_link_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    pub fn save_player_snapshot_cache(
        &self,
        platform_link_id: &str,
        snapshot_json: &str,
        fetched_at: &str,
        expires_at: &str,
    ) -> AppResult<()> {
        self.0.lock().execute(
            "INSERT INTO player_snapshot_cache(platform_link_id,snapshot_json,fetched_at,expires_at) VALUES(?1,?2,?3,?4) ON CONFLICT(platform_link_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at",
            params![platform_link_id, snapshot_json, fetched_at, expires_at],
        )?;
        Ok(())
    }

    pub fn list_platform_apps(&self) -> AppResult<Vec<PlatformApp>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare(
            "SELECT platform_code,name,executable_path,arguments_json,working_directory,prelaunch_check FROM platform_apps ORDER BY platform_code",
        )?;
        let apps = stmt
            .query_map([], |row| {
                Ok(PlatformApp {
                    platform_code: row.get(0)?,
                    name: row.get(1)?,
                    executable_path: row.get(2)?,
                    arguments: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default(),
                    working_directory: row.get(4)?,
                    prelaunch_check: row.get::<_, i64>(5)? != 0,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(apps)
    }

    pub fn ensure_platform_app(&self, app: &PlatformApp) -> AppResult<bool> {
        let conn = self.0.lock();
        let existing: Option<String> = conn
            .query_row(
                "SELECT executable_path FROM platform_apps WHERE platform_code=?1",
                [&app.platform_code],
                |row| row.get(0),
            )
            .optional()?;
        if existing
            .as_deref()
            .is_some_and(|path| Path::new(path).is_file())
        {
            return Ok(false);
        }
        let args = serde_json::to_string(&app.arguments)
            .map_err(|_| AppError::new("INVALID_ARGUMENTS", "鍚姩鍙傛暟鏃犳晥"))?;
        let changed = conn.execute("INSERT INTO platform_apps(platform_code,name,executable_path,arguments_json,working_directory,prelaunch_check,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(platform_code) DO UPDATE SET name=excluded.name,executable_path=excluded.executable_path,arguments_json=excluded.arguments_json,working_directory=excluded.working_directory,prelaunch_check=excluded.prelaunch_check,updated_at=excluded.updated_at", params![app.platform_code, app.name, app.executable_path, args, app.working_directory, app.prelaunch_check as i64, Utc::now().to_rfc3339()])?;
        Ok(changed > 0)
    }
    pub fn setting(&self, key: &str) -> AppResult<Option<String>> {
        Ok(self
            .0
            .lock()
            .query_row(
                "SELECT value_json FROM app_settings WHERE key=?1",
                [key],
                |r| r.get(0),
            )
            .optional()?)
    }
    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        self.0.lock().execute("INSERT INTO app_settings(key,value_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",params![key,value,Utc::now().to_rfc3339()])?;
        Ok(())
    }
    pub fn mark_switched(&self, steam_id: &str) -> AppResult<()> {
        self.0.lock().execute(
            "UPDATE steam_accounts SET last_switched_at=?1,updated_at=?1 WHERE steam_id64=?2",
            params![Utc::now().to_rfc3339(), steam_id],
        )?;
        Ok(())
    }

    pub fn delete_account(&self, id: &str) -> AppResult<()> {
        let deleted = self
            .0
            .lock()
            .execute("DELETE FROM steam_accounts WHERE id=?1", [id])?;
        if deleted == 0 {
            return Err(AppError::new("ACCOUNT_NOT_FOUND", "找不到该账号"));
        }
        Ok(())
    }

    pub fn list_cfg_profiles(&self) -> AppResult<Vec<CfgProfile>> {
        let conn = self.0.lock();
        let mut statement = conn.prepare(
            "SELECT p.id,p.name,p.file_name,p.content,p.created_at,p.updated_at,CASE WHEN r.profile_id IS NOT NULL THEN 'runtime' ELSE 'manual' END FROM cfg_profiles p LEFT JOIN cfg_runtime_profiles r ON r.profile_id=p.id ORDER BY p.name COLLATE NOCASE",
        )?;
        let profiles = statement
            .query_map([], |row| {
                Ok(CfgProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_name: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    source: row
                        .get::<_, Option<String>>(6)?
                        .filter(|value| !value.is_empty())
                        .unwrap_or_else(|| "manual".into()),
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(profiles)
    }

    pub fn ensure_active_cfg_profile(&self) -> AppResult<CfgProfile> {
        let mut conn = self.0.lock();
        let tx = conn.transaction()?;
        let configured = tx
            .query_row(
                "SELECT value_json FROM app_settings WHERE key='active_cfg_profile_id'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|value| serde_json::from_str::<String>(&value).ok());
        let selected = configured
            .and_then(|id| {
                tx.query_row(
                    "SELECT id,name,file_name,content,created_at,updated_at FROM cfg_profiles WHERE id=?1",
                    [id],
                    cfg_profile_from_row,
                )
                .optional()
                .ok()
                .flatten()
            })
            .or_else(|| {
                tx.query_row(
                    "SELECT p.id,p.name,p.file_name,p.content,p.created_at,p.updated_at FROM account_cfg_profiles x JOIN cfg_profiles p ON p.id=x.profile_id JOIN steam_accounts a ON a.id=x.steam_account_id ORDER BY COALESCE(a.last_switched_at,x.updated_at) DESC LIMIT 1",
                    [],
                    cfg_profile_from_row,
                )
                .optional()
                .ok()
                .flatten()
            })
            .or_else(|| {
                tx.query_row(
                    "SELECT id,name,file_name,content,created_at,updated_at FROM cfg_profiles ORDER BY updated_at DESC LIMIT 1",
                    [],
                    cfg_profile_from_row,
                )
                .optional()
                .ok()
                .flatten()
            });
        let profile = if let Some(profile) = selected {
            profile
        } else {
            let now = Utc::now().to_rfc3339();
            let profile = CfgProfile {
                id: Uuid::new_v4().to_string(),
                name: "默认配置".to_string(),
                file_name: "autoexec.cfg".to_string(),
                content: include_str!("../../src/lib/cs2-autoexec.template.cfg").to_string(),
                created_at: now.clone(),
                updated_at: now,
                source: "manual".into(),
            };
            tx.execute(
                "INSERT INTO cfg_profiles(id,name,file_name,content,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6)",
                params![profile.id,profile.name,profile.file_name,profile.content,profile.created_at,profile.updated_at],
            )?;
            profile
        };
        let value = serde_json::to_string(&profile.id)
            .map_err(|error| AppError::new("CFG_STATE_INVALID", error.to_string()))?;
        tx.execute(
            "INSERT INTO app_settings(key,value_json,updated_at) VALUES('active_cfg_profile_id',?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
            params![value,Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
        Ok(profile)
    }

    pub fn active_cfg_profile(&self) -> AppResult<CfgProfile> {
        self.ensure_active_cfg_profile()
    }

    pub fn set_active_cfg_profile(&self, id: &str) -> AppResult<CfgProfile> {
        let conn = self.0.lock();
        let profile = conn
            .query_row(
                "SELECT id,name,file_name,content,created_at,updated_at FROM cfg_profiles WHERE id=?1",
                [id],
                cfg_profile_from_row,
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new("CFG_PROFILE_NOT_FOUND", "找不到该 CS2 cfg 方案")
            })?;
        let value = serde_json::to_string(id)
            .map_err(|error| AppError::new("CFG_STATE_INVALID", error.to_string()))?;
        conn.execute(
            "INSERT INTO app_settings(key,value_json,updated_at) VALUES('active_cfg_profile_id',?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
            params![value,Utc::now().to_rfc3339()],
        )?;
        Ok(profile)
    }

    pub fn create_cfg_profile(
        &self,
        name: &str,
        file_name: &str,
        content: &str,
    ) -> AppResult<CfgProfile> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        self.0.lock().execute(
            "INSERT INTO cfg_profiles(id,name,file_name,content,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)",
            params![id, name, file_name, content, now],
        )?;
        Ok(CfgProfile {
            id,
            name: name.to_string(),
            file_name: file_name.to_string(),
            content: content.to_string(),
            created_at: now.clone(),
            updated_at: now,
            source: "manual".into(),
        })
    }

    pub fn save_cfg_profile(&self, id: &str, name: &str, content: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let changed = self.0.lock().execute(
            "UPDATE cfg_profiles SET name=?1,content=?2,updated_at=?3 WHERE id=?4",
            params![name, content, now, id],
        )?;
        if changed == 0 {
            Err(AppError::new(
                "CFG_PROFILE_NOT_FOUND",
                "找不到该 CS2 cfg 方案",
            ))
        } else {
            Ok(())
        }
    }

    pub fn delete_cfg_profile(&self, id: &str) -> AppResult<()> {
        self.0
            .lock()
            .execute("DELETE FROM cfg_profiles WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn delete_cfg_profile_and_repair_active(&self, id: &str) -> AppResult<CfgProfile> {
        let mut conn = self.0.lock();
        let tx = conn.transaction()?;
        let count: i64 = tx.query_row("SELECT COUNT(*) FROM cfg_profiles", [], |row| row.get(0))?;
        if count <= 1 {
            return Err(AppError::new(
                "CFG_LAST_PROFILE",
                "至少需要保留一个 CFG 方案",
            ));
        }
        let exists = tx
            .query_row("SELECT 1 FROM cfg_profiles WHERE id=?1", [id], |_| Ok(()))
            .optional()?
            .is_some();
        if !exists {
            return Err(AppError::new(
                "CFG_PROFILE_NOT_FOUND",
                "找不到该 CS2 cfg 方案",
            ));
        }
        tx.execute("DELETE FROM cfg_profiles WHERE id=?1", [id])?;
        let next = tx.query_row(
            "SELECT id,name,file_name,content,created_at,updated_at FROM cfg_profiles ORDER BY updated_at DESC LIMIT 1",
            [],
            cfg_profile_from_row,
        )?;
        let configured = tx
            .query_row(
                "SELECT value_json FROM app_settings WHERE key='active_cfg_profile_id'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|value| serde_json::from_str::<String>(&value).ok());
        if configured.as_deref() == Some(id) {
            let value = serde_json::to_string(&next.id)
                .map_err(|error| AppError::new("CFG_STATE_INVALID", error.to_string()))?;
            tx.execute(
                "INSERT INTO app_settings(key,value_json,updated_at) VALUES('active_cfg_profile_id',?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                params![value,Utc::now().to_rfc3339()],
            )?;
        }
        tx.commit()?;
        Ok(next)
    }

    pub fn assign_cfg_profile(&self, steam_account_id: &str, profile_id: &str) -> AppResult<()> {
        let conn = self.0.lock();
        let account_exists = conn
            .query_row(
                "SELECT 1 FROM steam_accounts WHERE id=?1",
                [steam_account_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        let profile_exists = conn
            .query_row(
                "SELECT 1 FROM cfg_profiles WHERE id=?1",
                [profile_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !account_exists || !profile_exists {
            return Err(AppError::new(
                "CFG_ASSIGNMENT_INVALID",
                "账号或 cfg 方案不存在",
            ));
        }
        conn.execute(
            "INSERT INTO account_cfg_profiles(steam_account_id,profile_id,updated_at) VALUES(?1,?2,?3) ON CONFLICT(steam_account_id) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at",
            params![steam_account_id, profile_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn remove_cfg_assignment(&self, steam_account_id: &str) -> AppResult<()> {
        self.0.lock().execute(
            "DELETE FROM account_cfg_profiles WHERE steam_account_id=?1",
            [steam_account_id],
        )?;
        Ok(())
    }

    pub fn list_cfg_assignments(&self) -> AppResult<Vec<AccountCfgAssignment>> {
        let conn = self.0.lock();
        let mut statement = conn.prepare(
            "SELECT a.id,a.steam_id64,p.id,p.name,p.file_name FROM account_cfg_profiles x JOIN steam_accounts a ON a.id=x.steam_account_id JOIN cfg_profiles p ON p.id=x.profile_id ORDER BY a.persona_name COLLATE NOCASE,a.account_name COLLATE NOCASE",
        )?;
        let assignments = statement
            .query_map([], |row| {
                Ok(AccountCfgAssignment {
                    steam_account_id: row.get(0)?,
                    steam_id64: row.get(1)?,
                    profile_id: row.get(2)?,
                    profile_name: row.get(3)?,
                    file_name: row.get(4)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(assignments)
    }

    pub fn mark_cfg_applied(&self, steam_id64: &str, file_name: &str) -> AppResult<()> {
        self.0.lock().execute(
            "INSERT INTO account_cfg_deployments(steam_account_id,last_applied_file,updated_at) SELECT id,?1,?2 FROM steam_accounts WHERE steam_id64=?3 ON CONFLICT(steam_account_id) DO UPDATE SET last_applied_file=excluded.last_applied_file,updated_at=excluded.updated_at",
            params![file_name,Utc::now().to_rfc3339(),steam_id64],
        )?;
        Ok(())
    }

    pub fn last_applied_cfg_file(&self, steam_id64: &str) -> AppResult<Option<String>> {
        Ok(self
            .0
            .lock()
            .query_row(
                "SELECT d.last_applied_file FROM account_cfg_deployments d JOIN steam_accounts a ON a.id=d.steam_account_id WHERE a.steam_id64=?1",
                [steam_id64],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn cfg_assignment_profile_id(&self, steam_account_id: &str) -> AppResult<Option<String>> {
        Ok(self
            .0
            .lock()
            .query_row(
                "SELECT profile_id FROM account_cfg_profiles WHERE steam_account_id=?1",
                [steam_account_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn record_runtime_snapshot(
        &self,
        input: &RuntimeSnapshotInput<'_>,
    ) -> AppResult<(String, bool)> {
        let conn = self.0.lock();
        let now = Utc::now().to_rfc3339();
        if let Some(id) = conn
            .query_row(
                "SELECT id FROM cfg_runtime_snapshots WHERE steam_account_id=?1 AND content_hash=?2",
                params![input.steam_account_id, input.content_hash],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            conn.execute(
                "UPDATE cfg_runtime_snapshots SET last_seen_at=?1,trigger=?2,source_path=?3 WHERE id=?4",
                params![now, input.trigger, input.source_path, id],
            )?;
            return Ok((id, false));
        }
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO cfg_runtime_snapshots(id,steam_account_id,captured_at,last_seen_at,trigger,source_path,content_hash,file_count,files_json,cfg_content) VALUES(?1,?2,?3,?3,?4,?5,?6,?7,?8,?9)",
            params![id, input.steam_account_id, now, input.trigger, input.source_path, input.content_hash, input.file_count, input.files_json, input.cfg_content],
        )?;
        Ok((id, true))
    }

    pub fn latest_runtime_snapshot_seen_at(
        &self,
        steam_account_id: &str,
    ) -> AppResult<Option<String>> {
        Ok(self
            .0
            .lock()
            .query_row(
                "SELECT last_seen_at FROM cfg_runtime_snapshots WHERE steam_account_id=?1 ORDER BY last_seen_at DESC LIMIT 1",
                [steam_account_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn runtime_synced_cfg_content(
        &self,
        steam_account_id: &str,
        content_hash: &str,
    ) -> AppResult<Option<String>> {
        Ok(self
            .0
            .lock()
            .query_row(
                "SELECT cfg_content FROM cfg_runtime_snapshots WHERE steam_account_id=?1 AND content_hash=?2",
                params![steam_account_id, content_hash],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn runtime_profile_state(
        &self,
        steam_account_id: &str,
    ) -> AppResult<Option<(CfgProfile, String)>> {
        let conn = self.0.lock();
        Ok(conn
            .query_row(
                "SELECT p.id,p.name,p.file_name,p.content,p.created_at,p.updated_at,r.last_synced_hash FROM cfg_runtime_profiles r JOIN cfg_profiles p ON p.id=r.profile_id WHERE r.steam_account_id=?1",
                [steam_account_id],
                |row| {
                    Ok((
                        CfgProfile {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            file_name: row.get(2)?,
                            content: row.get(3)?,
                            created_at: row.get(4)?,
                            updated_at: row.get(5)?,
                            source: "runtime".into(),
                        },
                        row.get(6)?,
                    ))
                },
            )
            .optional()?)
    }

    pub fn link_runtime_profile(
        &self,
        steam_account_id: &str,
        profile_id: &str,
        content_hash: &str,
    ) -> AppResult<()> {
        self.0.lock().execute(
            "INSERT INTO cfg_runtime_profiles(steam_account_id,profile_id,last_synced_hash,last_synced_at) VALUES(?1,?2,?3,?4) ON CONFLICT(steam_account_id) DO UPDATE SET profile_id=excluded.profile_id,last_synced_hash=excluded.last_synced_hash,last_synced_at=excluded.last_synced_at",
            params![steam_account_id, profile_id, content_hash, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn prune_runtime_snapshots(
        &self,
        steam_account_id: &str,
        keep: usize,
    ) -> AppResult<Vec<String>> {
        let conn = self.0.lock();
        let keep_hash: Option<String> = conn
            .query_row(
                "SELECT last_synced_hash FROM cfg_runtime_profiles WHERE steam_account_id=?1",
                [steam_account_id],
                |row| row.get(0),
            )
            .optional()?;
        let mut statement = conn.prepare(
            "SELECT id,content_hash FROM cfg_runtime_snapshots WHERE steam_account_id=?1 ORDER BY last_seen_at DESC, captured_at DESC",
        )?;
        let rows = statement
            .query_map([steam_account_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut retain = HashSet::new();
        for (index, (id, hash)) in rows.iter().enumerate() {
            if index < keep || keep_hash.as_deref() == Some(hash.as_str()) {
                retain.insert(id.clone());
            }
        }
        let removed_ids = rows
            .iter()
            .filter(|(id, _)| !retain.contains(id))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        if !removed_ids.is_empty() {
            let placeholders = removed_ids
                .iter()
                .enumerate()
                .map(|(index, _)| format!("?{}", index + 1))
                .collect::<Vec<_>>()
                .join(",");
            conn.execute(
                &format!("DELETE FROM cfg_runtime_snapshots WHERE id IN ({placeholders})"),
                params_from_iter(removed_ids.iter()),
            )?;
        }
        let remaining: HashSet<String> = conn
            .prepare("SELECT content_hash FROM cfg_runtime_snapshots WHERE steam_account_id=?1")?
            .query_map([steam_account_id], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(rows
            .into_iter()
            .map(|(_, hash)| hash)
            .filter(|hash| !remaining.contains(hash))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect())
    }

    pub fn runtime_snapshot_by_id(&self, id: &str) -> AppResult<CfgRuntimeSnapshot> {
        self.0
            .lock()
            .query_row(
                "SELECT id,steam_account_id,captured_at,last_seen_at,trigger,source_path,content_hash,file_count,files_json,cfg_content FROM cfg_runtime_snapshots WHERE id=?1",
                [id],
                |row| {
                    let files_json: String = row.get(8)?;
                    Ok(CfgRuntimeSnapshot {
                        id: row.get(0)?,
                        steam_account_id: row.get(1)?,
                        captured_at: row.get(2)?,
                        last_seen_at: row.get(3)?,
                        trigger: row.get(4)?,
                        source_path: row.get(5)?,
                        content_hash: row.get(6)?,
                        file_count: row.get(7)?,
                        files: parse_runtime_files(&files_json),
                        cfg_content: row.get(9)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| AppError::new("CFG_RUNTIME_NOT_FOUND", "找不到该运行配置记录"))
    }

    pub fn list_runtime_cfg_snapshots(
        &self,
        steam_account_id: &str,
    ) -> AppResult<Vec<CfgRuntimeSnapshot>> {
        let conn = self.0.lock();
        let mut statement = conn.prepare(
            "SELECT id,steam_account_id,captured_at,last_seen_at,trigger,source_path,content_hash,file_count,files_json,cfg_content FROM cfg_runtime_snapshots WHERE steam_account_id=?1 ORDER BY last_seen_at DESC, captured_at DESC",
        )?;
        let snapshots = statement
            .query_map([steam_account_id], |row| {
                let files_json: String = row.get(8)?;
                Ok(CfgRuntimeSnapshot {
                    id: row.get(0)?,
                    steam_account_id: row.get(1)?,
                    captured_at: row.get(2)?,
                    last_seen_at: row.get(3)?,
                    trigger: row.get(4)?,
                    source_path: row.get(5)?,
                    content_hash: row.get(6)?,
                    file_count: row.get(7)?,
                    files: parse_runtime_files(&files_json),
                    cfg_content: row.get(9)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(snapshots)
    }

    fn travel_platform_cred(
        &self,
        steam_account_id: &str,
        platform_code: &str,
    ) -> AppResult<Option<(String, TravelPlatformCred)>> {
        let conn = self.0.lock();
        Ok(conn
            .query_row(
                "SELECT l.id,p.display_name,p.login_account,p.login_password,p.remark FROM account_platform_links l JOIN platform_accounts p ON p.id=l.platform_account_id WHERE l.steam_account_id=?1 AND p.platform_code=?2 LIMIT 1",
                params![steam_account_id, platform_code],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        TravelPlatformCred {
                            display_name: row.get(1)?,
                            login_account: row.get(2)?,
                            login_password: row.get(3)?,
                            remark: row.get(4)?,
                        },
                    ))
                },
            )
            .optional()?)
    }

    fn assigned_or_runtime_cfg(&self, steam_account_id: &str) -> AppResult<Option<TravelCfg>> {
        let conn = self.0.lock();
        let assigned = conn
            .query_row(
                "SELECT p.name,p.file_name,p.content FROM account_cfg_profiles x JOIN cfg_profiles p ON p.id=x.profile_id WHERE x.steam_account_id=?1",
                [steam_account_id],
                |row| {
                    Ok(TravelCfg {
                        name: row.get(0)?,
                        file_name: row.get(1)?,
                        content: row.get(2)?,
                    })
                },
            )
            .optional()?;
        if assigned.is_some() {
            return Ok(assigned);
        }
        Ok(conn
            .query_row(
                "SELECT p.name,p.file_name,p.content FROM cfg_runtime_profiles r JOIN cfg_profiles p ON p.id=r.profile_id WHERE r.steam_account_id=?1",
                [steam_account_id],
                |row| {
                    Ok(TravelCfg {
                        name: row.get(0)?,
                        file_name: row.get(1)?,
                        content: row.get(2)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn list_travel_identities(&self) -> AppResult<Vec<TravelIdentity>> {
        let conn = self.0.lock();
        let mut statement = conn.prepare(
            "SELECT a.id,a.steam_id64,a.account_name,a.persona_name,a.local_available,p.alias,p.remark FROM steam_accounts a LEFT JOIN account_profiles p ON p.steam_account_id=a.id ORDER BY COALESCE(p.alias,a.persona_name,a.account_name,a.steam_id64) COLLATE NOCASE",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)? != 0,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        drop(conn);
        let mut identities = Vec::new();
        for (id, steam_id64, account_name, persona_name, local_available, alias, remark) in rows {
            identities.push(TravelIdentity {
                five_e: self.travel_platform_cred(&id, "5e")?.map(|(_, cred)| cred),
                perfect_world: self
                    .travel_platform_cred(&id, "perfectworld")?
                    .map(|(_, cred)| cred),
                cfg: self.assigned_or_runtime_cfg(&id)?,
                steam_account_id: id,
                steam_id64,
                account_name,
                persona_name,
                alias,
                remark,
                local_available,
            });
        }
        Ok(identities)
    }

    fn upsert_travel_account(&self, identity: &TravelIdentity) -> AppResult<String> {
        validate_steam_id(&identity.steam_id64)?;
        let now = Utc::now().to_rfc3339();
        let conn = self.0.lock();
        if let Some(id) = conn
            .query_row(
                "SELECT id FROM steam_accounts WHERE steam_id64=?1",
                [&identity.steam_id64],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            conn.execute(
                "UPDATE steam_accounts SET account_name=COALESCE(?1,account_name),persona_name=COALESCE(?2,persona_name),updated_at=?3 WHERE id=?4",
                params![identity.account_name, identity.persona_name, now, id],
            )?;
            conn.execute(
                "INSERT INTO account_profiles(steam_account_id,alias,remark) VALUES(?1,?2,?3) ON CONFLICT(steam_account_id) DO UPDATE SET alias=COALESCE(excluded.alias,account_profiles.alias),remark=COALESCE(excluded.remark,account_profiles.remark)",
                params![id, identity.alias, identity.remark],
            )?;
            return Ok(id);
        }
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO steam_accounts(id,steam_id64,account_name,persona_name,local_available,created_at,updated_at) VALUES(?1,?2,?3,?4,0,?5,?5)",
            params![id, identity.steam_id64, identity.account_name, identity.persona_name, now],
        )?;
        conn.execute(
            "INSERT INTO account_profiles(steam_account_id,alias,remark) VALUES(?1,?2,?3)",
            params![id, identity.alias, identity.remark],
        )?;
        Ok(id)
    }

    fn upsert_travel_platform(
        &self,
        steam_account_id: &str,
        platform_code: &str,
        cred: &TravelPlatformCred,
    ) -> AppResult<()> {
        let existing = self.travel_platform_cred(steam_account_id, platform_code)?;
        let (id, merged) = if let Some((id, current)) = existing {
            (
                Some(id),
                TravelPlatformCred {
                    display_name: cred.display_name.clone().or(current.display_name),
                    login_account: cred.login_account.clone().or(current.login_account),
                    login_password: cred
                        .login_password
                        .clone()
                        .filter(|value| !value.is_empty())
                        .or(current.login_password),
                    remark: cred.remark.clone().or(current.remark),
                },
            )
        } else {
            (None, cred.clone())
        };
        self.save_link(&PlatformLinkInput {
            id,
            steam_account_id: steam_account_id.to_string(),
            platform_code: platform_code.to_string(),
            external_id: merged.display_name.clone(),
            display_name: merged.display_name,
            profile_url: None,
            login_account: merged.login_account,
            login_password: merged.login_password,
            remark: merged.remark,
            status: "unverified".into(),
        })
    }

    pub fn import_travel_identities(
        &self,
        identities: &[TravelIdentity],
    ) -> AppResult<(TravelImportResult, Vec<CfgProfile>)> {
        let mut platform_count = 0;
        let mut cfg_count = 0;
        let mut written = Vec::new();
        for identity in identities {
            let account_id = self.upsert_travel_account(identity)?;
            if let Some(cred) = identity
                .five_e
                .as_ref()
                .filter(|cred| travel_cred_has_value(cred))
            {
                self.upsert_travel_platform(&account_id, "5e", cred)?;
                platform_count += 1;
            }
            if let Some(cred) = identity
                .perfect_world
                .as_ref()
                .filter(|cred| travel_cred_has_value(cred))
            {
                self.upsert_travel_platform(&account_id, "perfectworld", cred)?;
                platform_count += 1;
            }
            if let Some(cfg) = identity
                .cfg
                .as_ref()
                .filter(|cfg| !cfg.content.trim().is_empty())
            {
                let existing = self.cfg_assignment_profile_id(&account_id)?;
                let profile = if let Some(profile_id) = existing {
                    let profiles = self.list_cfg_profiles()?;
                    let current = profiles
                        .into_iter()
                        .find(|profile| profile.id == profile_id);
                    if let Some(current) = current.filter(|profile| {
                        profile
                            .file_name
                            .to_ascii_lowercase()
                            .starts_with("travel-")
                    }) {
                        self.save_cfg_profile(&current.id, &cfg.name, &cfg.content)?;
                        CfgProfile {
                            content: cfg.content.clone(),
                            name: cfg.name.clone(),
                            ..current
                        }
                    } else {
                        let file_name = unique_travel_cfg_file_name(
                            &identity.steam_id64,
                            &self
                                .list_cfg_profiles()?
                                .into_iter()
                                .map(|profile| profile.file_name)
                                .collect::<Vec<_>>(),
                        );
                        let created =
                            self.create_cfg_profile(&cfg.name, &file_name, &cfg.content)?;
                        self.assign_cfg_profile(&account_id, &created.id)?;
                        created
                    }
                } else {
                    let file_name = unique_travel_cfg_file_name(
                        &identity.steam_id64,
                        &self
                            .list_cfg_profiles()?
                            .into_iter()
                            .map(|profile| profile.file_name)
                            .collect::<Vec<_>>(),
                    );
                    let created = self.create_cfg_profile(
                        if cfg.name.trim().is_empty() {
                            "外出配置"
                        } else {
                            &cfg.name
                        },
                        &file_name,
                        &cfg.content,
                    )?;
                    self.assign_cfg_profile(&account_id, &created.id)?;
                    created
                };
                written.push(profile);
                cfg_count += 1;
            }
        }
        Ok((
            TravelImportResult {
                identity_count: identities.len(),
                platform_count,
                cfg_count,
            },
            written,
        ))
    }

    pub fn list_runtime_cfg_accounts(&self) -> AppResult<Vec<CfgRuntimeAccountSummary>> {
        let conn = self.0.lock();
        let mut statement = conn.prepare(
            "SELECT a.id,a.steam_id64,a.persona_name,a.account_name,s.id,s.captured_at,s.last_seen_at,s.trigger,s.source_path,s.content_hash,s.file_count,s.files_json,s.cfg_content,(SELECT COUNT(*) FROM cfg_runtime_snapshots x WHERE x.steam_account_id=a.id),p.id,p.name,p.file_name,p.content FROM steam_accounts a JOIN cfg_runtime_snapshots s ON s.id=(SELECT s2.id FROM cfg_runtime_snapshots s2 WHERE s2.steam_account_id=a.id ORDER BY s2.last_seen_at DESC,s2.captured_at DESC LIMIT 1) LEFT JOIN cfg_runtime_profiles r ON r.steam_account_id=a.id LEFT JOIN cfg_profiles p ON p.id=r.profile_id ORDER BY s.last_seen_at DESC",
        )?;
        let accounts = statement
            .query_map([], |row| {
                let files_json: String = row.get(11)?;
                let cfg_content: String = row.get(12)?;
                let profile_content: Option<String> = row.get(17)?;
                Ok(CfgRuntimeAccountSummary {
                    steam_account_id: row.get(0)?,
                    steam_id64: row.get(1)?,
                    persona_name: row.get(2)?,
                    account_name: row.get(3)?,
                    snapshot_id: row.get(4)?,
                    captured_at: row.get(5)?,
                    last_seen_at: row.get(6)?,
                    trigger: row.get(7)?,
                    source_path: row.get(8)?,
                    content_hash: row.get(9)?,
                    file_count: row.get(10)?,
                    files: parse_runtime_files(&files_json),
                    history_count: row.get(13)?,
                    profile_id: row.get(14)?,
                    profile_name: row.get(15)?,
                    profile_file_name: row.get(16)?,
                    profile_dirty: profile_content
                        .as_ref()
                        .is_some_and(|content| content != &cfg_content),
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(accounts)
    }
}

fn travel_cred_has_value(cred: &TravelPlatformCred) -> bool {
    [
        cred.display_name.as_deref(),
        cred.login_account.as_deref(),
        cred.login_password.as_deref(),
        cred.remark.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|value| !value.trim().is_empty())
}

fn unique_travel_cfg_file_name(steam_id64: &str, existing: &[String]) -> String {
    let suffix = steam_id64
        .chars()
        .rev()
        .take(8)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    let known = existing
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let mut candidate = format!("travel-{suffix}.cfg");
    let mut index = 2;
    while known.contains(&candidate.to_ascii_lowercase()) {
        candidate = format!("travel-{suffix}-{index}.cfg");
        index += 1;
    }
    candidate
}

pub fn validate_steam_id(value: &str) -> AppResult<()> {
    if value.len() != 17 || value.parse::<u64>().is_err() {
        Err(AppError::new(
            "INVALID_STEAM_ID",
            "SteamID64 必须是 17 位数字",
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(db: &Database, steam_id64: &str, tags: &[&str]) -> ProfileInput {
        ProfileInput {
            account_id: db
                .account_id_by_steam_id(steam_id64)
                .expect("lookup")
                .expect("scanned account"),
            alias: Some("主力".into()),
            remark: None,
            favorite: false,
            tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
        }
    }

    fn local_account(steam_id64: &str) -> LocalSteamAccount {
        LocalSteamAccount {
            steam_id64: steam_id64.into(),
            account_name: Some("alpha".into()),
            persona_name: Some("玩家".into()),
            remember_password: true,
            allow_auto_login: true,
            most_recent: true,
            timestamp: None,
        }
    }
    #[test]
    fn migration_and_unique_id() {
        let t = tempfile::tempdir().expect("temp");
        let db = Database::open(&t.path().join("a.db")).expect("db");
        db.sync_accounts(&[local_account("76561198000000001")])
            .expect("scan");
        let input = profile(&db, "76561198000000001", &[]);
        db.save_profile(&input).expect("one");
        db.save_profile(&input).expect("merge");
        assert_eq!(db.list_accounts().expect("list").len(), 1);
        let unknown = ProfileInput {
            account_id: "missing".into(),
            ..input
        };
        assert_eq!(
            db.save_profile(&unknown).expect_err("unknown profile").code,
            "ACCOUNT_NOT_FOUND"
        );
    }

    #[test]
    fn platform_summary_is_assembled_with_accounts() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("platform.db")).expect("db");
        db.sync_accounts(&[local_account("76561198000000001")])
            .expect("scan");
        db.save_profile(&profile(&db, "76561198000000001", &[]))
            .expect("profile");
        let account = db.list_accounts().expect("accounts").remove(0);
        for platform in ["5e", "faceit"] {
            db.save_link(&PlatformLinkInput {
                id: None,
                steam_account_id: account.id.clone(),
                platform_code: platform.into(),
                external_id: None,
                display_name: None,
                profile_url: None,
                login_account: None,
                login_password: None,
                remark: None,
                status: "unverified".into(),
            })
            .expect("platform link");
        }
        assert_eq!(
            db.list_accounts().expect("accounts")[0].platform_codes,
            vec!["5e", "faceit"]
        );
    }

    #[test]
    fn player_snapshot_cache_persists_only_normalized_snapshot_and_expiry() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("player-cache.db")).expect("db");
        db.sync_accounts(&[local_account("76561198000000001")])
            .expect("scan");
        let account = db.list_accounts().expect("accounts").remove(0);
        db.save_link(&PlatformLinkInput {
            id: Some("link-5e".into()),
            steam_account_id: account.id.clone(),
            platform_code: "5e".into(),
            external_id: Some("123456".into()),
            display_name: None,
            profile_url: None,
            login_account: Some("five-user".into()),
            login_password: Some("plain-password".into()),
            remark: None,
            status: "user_confirmed".into(),
        })
        .expect("platform link");
        let normalized = r#"{"platform":"5e","externalId":"123456","warnings":[]}"#;

        db.save_player_snapshot_cache(
            "link-5e",
            normalized,
            "2026-07-27T08:00:00Z",
            "2026-07-27T08:15:00Z",
        )
        .expect("save snapshot");

        let cached = db
            .player_snapshot_cache("link-5e")
            .expect("read snapshot")
            .expect("snapshot exists");
        assert_eq!(cached.0, normalized);
        assert_eq!(cached.1, "2026-07-27T08:15:00Z");
        assert!(!cached.0.contains("token"));

        db.save_link(&PlatformLinkInput {
            id: Some("link-5e".into()),
            steam_account_id: account.id,
            platform_code: "5e".into(),
            external_id: Some("654321".into()),
            display_name: Some("新玩家".into()),
            profile_url: None,
            login_account: Some("five-user".into()),
            login_password: Some("plain-password".into()),
            remark: None,
            status: "unverified".into(),
        })
        .expect("change linked player");
        assert!(db
            .player_snapshot_cache("link-5e")
            .expect("read cleared snapshot")
            .is_none());
    }

    #[test]
    fn scheduled_five_e_refresh_selects_only_links_with_player_identifiers() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("five-e-refresh.db")).expect("db");
        db.sync_accounts(&[local_account("76561198000000001")])
            .expect("scan");
        let account = db.list_accounts().expect("accounts").remove(0);
        for (id, platform_code, external_id) in [
            ("five-e-ready", "5e", Some("玩家名称")),
            ("five-e-empty", "5e", Some("   ")),
            ("perfect-ready", "perfectworld", Some("76561198000000001")),
        ] {
            db.save_link(&PlatformLinkInput {
                id: Some(id.into()),
                steam_account_id: account.id.clone(),
                platform_code: platform_code.into(),
                external_id: external_id.map(str::to_string),
                display_name: None,
                profile_url: None,
                login_account: None,
                login_password: None,
                remark: None,
                status: "unverified".into(),
            })
            .expect("platform link");
        }

        let links = db.refreshable_five_e_links().expect("refreshable links");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].id, "five-e-ready");
        assert_eq!(links[0].external_id.as_deref(), Some("玩家名称"));
    }

    #[test]
    fn hidden_accounts_keep_profile_and_restore_after_credentials_return() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("tags.db")).expect("db");
        db.sync_accounts(&[local_account("76561198000000001")])
            .expect("scan");
        db.save_profile(&profile(
            &db,
            "76561198000000001",
            &["竞技", "竞技", "RANKED", "ranked"],
        ))
        .expect("profile");
        let account = db.list_accounts().expect("accounts").remove(0);
        assert_eq!(account.tags.len(), 2);
        db.sync_accounts(&[]).expect("credentials removed");
        let hidden = db.list_accounts().expect("kept without credentials");
        assert_eq!(hidden.len(), 1);
        assert!(!hidden[0].local_available);
        assert_eq!(db.list_tags().expect("tag history").len(), 2);
        db.sync_accounts(&[local_account("76561198000000001")])
            .expect("credentials restored");
        let restored = db.list_accounts().expect("restored list").remove(0);
        assert_eq!(restored.alias.as_deref(), Some("主力"));
        assert_eq!(restored.tags.len(), 2);
    }

    #[test]
    fn global_active_cfg_is_created_repaired_and_persisted() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("cfg.db")).expect("db");

        let initial = db.ensure_active_cfg_profile().expect("default profile");
        assert_eq!(initial.file_name, "autoexec.cfg");
        assert!(initial.content.contains("cl_crosshairstyle 4"));
        assert!(initial.content.contains("cl_hud_telemetry_frametime_show"));
        assert_eq!(db.active_cfg_profile().expect("persisted").id, initial.id);

        let second = db
            .create_cfg_profile("Practice", "practice.cfg", "sv_cheats 1")
            .expect("second profile");
        assert_eq!(
            db.set_active_cfg_profile(&second.id).expect("select").id,
            second.id
        );
        db.delete_cfg_profile_and_repair_active(&second.id)
            .expect("delete selected");
        assert_eq!(db.active_cfg_profile().expect("repaired").id, initial.id);
        assert_eq!(
            db.delete_cfg_profile_and_repair_active(&initial.id)
                .expect_err("last profile cannot be deleted")
                .code,
            "CFG_LAST_PROFILE"
        );
    }

    #[test]
    fn cfg_save_updates_profile_without_creating_history_snapshots() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("cfg-save.db")).expect("db");
        let profile = db.ensure_active_cfg_profile().expect("default profile");
        db.0.lock()
            .execute(
                "INSERT INTO cfg_profile_versions(id,profile_id,content,created_at) VALUES('legacy-version',?1,'old content','2026-07-28T00:00:00Z')",
                [&profile.id],
            )
            .expect("legacy history");

        db.save_cfg_profile(&profile.id, "Updated", "fps_max 400")
            .expect("save profile");

        let saved = db.active_cfg_profile().expect("saved profile");
        assert_eq!(saved.name, "Updated");
        assert_eq!(saved.content, "fps_max 400");
        let history_count: i64 =
            db.0.lock()
                .query_row(
                    "SELECT COUNT(*) FROM cfg_profile_versions WHERE profile_id=?1",
                    [&profile.id],
                    |row| row.get(0),
                )
                .expect("history count");
        assert_eq!(history_count, 1);
        assert_eq!(
            db.save_cfg_profile("missing", "Missing", "")
                .expect_err("missing profile")
                .code,
            "CFG_PROFILE_NOT_FOUND"
        );
    }

    #[test]
    fn existing_database_receives_plaintext_platform_credential_columns() {
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("legacy.db");
        let connection = Connection::open(&path).expect("legacy database");
        connection
            .execute_batch(
                "CREATE TABLE platform_accounts (
                    id TEXT PRIMARY KEY,
                    platform_code TEXT NOT NULL,
                    external_id TEXT,
                    display_name TEXT,
                    profile_url TEXT,
                    remark TEXT,
                    status TEXT NOT NULL DEFAULT 'unverified',
                    binding_method TEXT NOT NULL DEFAULT 'manual',
                    last_verified_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );",
            )
            .expect("legacy schema");
        drop(connection);

        let db = Database::open(&path).expect("migrated database");
        let connection = db.0.lock();
        assert!(
            has_column(&connection, "platform_accounts", "login_account").expect("account column")
        );
        assert!(
            has_column(&connection, "platform_accounts", "login_password")
                .expect("password column")
        );
    }

    #[test]
    fn backup_round_trip_includes_platform_passwords_and_excludes_runtime_data() {
        let source_dir = tempfile::tempdir().expect("source");
        let source = Database::open(&source_dir.path().join("source.db")).expect("source db");
        source
            .sync_accounts(&[local_account("76561198000000001")])
            .expect("scan");
        let account = source.list_accounts().expect("account").remove(0);
        source
            .save_link(&PlatformLinkInput {
                id: Some("five-link".into()),
                steam_account_id: account.id,
                platform_code: "5e".into(),
                external_id: Some("查询昵称".into()),
                display_name: Some("查询昵称".into()),
                profile_url: None,
                login_account: Some("five-login".into()),
                login_password: Some("plain-password".into()),
                remark: Some("需要短信验证".into()),
                status: "unverified".into(),
            })
            .expect("platform credentials");
        source
            .set_setting("theme", "\"glacier\"")
            .expect("normal setting");
        source
            .set_setting("credential.5e.expired", "true")
            .expect("credential state");

        let document = source.export_backup().expect("export");
        let serialized = serde_json::to_string(&document).expect("serialize");
        assert!(serialized.contains("plain-password"));
        assert!(!serialized.contains("credential.5e.expired"));
        assert!(!serialized.contains("player_snapshot_cache"));
        assert!(!serialized.contains("switch_logs"));
        let preview = Database::preview_backup(&document).expect("preview");
        assert_eq!(preview.account_count, 1);
        assert_eq!(preview.platform_link_count, 1);

        let target_dir = tempfile::tempdir().expect("target");
        let target = Database::open(&target_dir.path().join("target.db")).expect("target db");
        target.restore_backup(&document).expect("restore");
        let restored_account = target.list_accounts().expect("restored account").remove(0);
        let restored = target
            .list_links(&restored_account.id)
            .expect("restored links")
            .remove(0);
        assert_eq!(restored.login_account.as_deref(), Some("five-login"));
        assert_eq!(restored.login_password.as_deref(), Some("plain-password"));
        assert_eq!(restored.remark.as_deref(), Some("需要短信验证"));
        assert_eq!(
            target
                .setting("theme")
                .expect("restored setting")
                .as_deref(),
            Some("\"glacier\"")
        );
    }

    #[test]
    fn travel_identities_import_without_local_steam_credentials() {
        let home_dir = tempfile::tempdir().expect("home");
        let home = Database::open(&home_dir.path().join("home.db")).expect("home db");
        home.sync_accounts(&[local_account("76561198000000001")])
            .expect("scan");
        let account = home.list_accounts().expect("account").remove(0);
        home.save_link(&PlatformLinkInput {
            id: Some("five".into()),
            steam_account_id: account.id.clone(),
            platform_code: "5e".into(),
            external_id: Some("查询昵称".into()),
            display_name: Some("查询昵称".into()),
            profile_url: None,
            login_account: Some("five-login".into()),
            login_password: Some("five-pass".into()),
            remark: None,
            status: "unverified".into(),
        })
        .expect("5e");
        let cfg = home
            .create_cfg_profile("主力配置", "travel-home.cfg", "sensitivity 1.2\n")
            .expect("cfg");
        home.assign_cfg_profile(&account.id, &cfg.id)
            .expect("assign");

        let pack = home.list_travel_identities().expect("export");
        assert_eq!(pack.len(), 1);
        assert_eq!(pack[0].account_name.as_deref(), Some("alpha"));
        assert_eq!(
            pack[0]
                .five_e
                .as_ref()
                .and_then(|cred| cred.login_password.as_deref()),
            Some("five-pass")
        );

        let cafe_dir = tempfile::tempdir().expect("cafe");
        let cafe = Database::open(&cafe_dir.path().join("cafe.db")).expect("cafe db");
        cafe.import_travel_identities(&pack).expect("import");
        let listed = cafe.list_accounts().expect("account list");
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].local_available);
        let imported = cafe.list_travel_identities().expect("travel");
        assert_eq!(imported.len(), 1);
        assert!(!imported[0].local_available);
        assert_eq!(imported[0].account_name.as_deref(), Some("alpha"));
        assert_eq!(
            imported[0]
                .five_e
                .as_ref()
                .and_then(|cred| cred.login_account.as_deref()),
            Some("five-login")
        );
        assert_eq!(
            imported[0].cfg.as_ref().map(|cfg| cfg.content.as_str()),
            Some("sensitivity 1.2\n")
        );
        cafe.delete_account(&listed[0].id).expect("delete");
        assert!(cafe.list_accounts().expect("deleted").is_empty());
    }

    #[test]
    fn old_backups_without_runtime_cfg_tables_still_restore() {
        let source_dir = tempfile::tempdir().expect("source");
        let source = Database::open(&source_dir.path().join("source.db")).expect("source db");
        source
            .sync_accounts(&[local_account("76561198000000001")])
            .expect("scan");
        let mut document = source.export_backup().expect("export");
        let tables = document["tables"].as_object_mut().expect("tables");
        tables.remove("cfg_runtime_snapshots");
        tables.remove("cfg_runtime_profiles");
        let target_dir = tempfile::tempdir().expect("target");
        let target = Database::open(&target_dir.path().join("target.db")).expect("target db");
        target
            .restore_backup(&document)
            .expect("restore old backup");
        assert_eq!(target.list_accounts().expect("accounts").len(), 1);
        assert!(target
            .list_runtime_cfg_accounts()
            .expect("runtime")
            .is_empty());
    }

    #[test]
    fn selective_restore_imports_only_locally_matched_steam_accounts() {
        let source_dir = tempfile::tempdir().expect("source");
        let source = Database::open(&source_dir.path().join("source.db")).expect("source db");
        source
            .sync_accounts(&[
                local_account("76561198000000001"),
                local_account("76561198000000002"),
            ])
            .expect("source scan");
        for account in source.list_accounts().expect("source accounts") {
            source
                .save_link(&PlatformLinkInput {
                    id: Some(format!("link-{}", account.steam_id64)),
                    steam_account_id: account.id,
                    platform_code: "5e".into(),
                    external_id: Some(format!("玩家{}", account.steam_id64)),
                    display_name: Some(format!("玩家{}", account.steam_id64)),
                    profile_url: None,
                    login_account: Some(format!("login-{}", account.steam_id64)),
                    login_password: Some("plain-password".into()),
                    remark: Some("导入备注".into()),
                    status: "user_confirmed".into(),
                })
                .expect("source link");
        }
        source
            .set_setting("theme", "\"glacier\"")
            .expect("source theme");
        let document = source.export_backup().expect("export");

        let target_dir = tempfile::tempdir().expect("target");
        let target = Database::open(&target_dir.path().join("target.db")).expect("target db");
        target
            .sync_accounts(&[
                local_account("76561198000000001"),
                local_account("76561198000000009"),
            ])
            .expect("target scan");
        target
            .set_setting("theme", "\"mint\"")
            .expect("target theme");
        let preview = target
            .preview_backup_for_restore(&document)
            .expect("matched preview");
        assert_eq!(preview.matched_account_count, 1);
        assert_eq!(preview.skipped_account_count, 1);
        assert_eq!(preview.matched_platform_link_count, 1);

        target
            .restore_backup_selected(
                &document,
                crate::models::RestoreSelection {
                    accounts: true,
                    cfg: false,
                    settings: false,
                },
            )
            .expect("selective restore");
        let accounts = target.list_accounts().expect("local accounts");
        assert_eq!(accounts.len(), 2);
        let matched = accounts
            .iter()
            .find(|account| account.steam_id64 == "76561198000000001")
            .expect("matched account");
        let link = target
            .list_links(&matched.id)
            .expect("matched links")
            .remove(0);
        assert_eq!(link.login_password.as_deref(), Some("plain-password"));
        assert_eq!(link.remark.as_deref(), Some("导入备注"));
        assert!(accounts
            .iter()
            .all(|account| account.steam_id64 != "76561198000000002"));
        assert_eq!(
            target.setting("theme").expect("preserved theme").as_deref(),
            Some("\"mint\"")
        );
    }

    #[test]
    fn failed_restore_rolls_back_the_existing_database() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("rollback.db")).expect("db");
        db.sync_accounts(&[local_account("76561198000000009")])
            .expect("scan");
        let mut invalid = db.export_backup().expect("export");
        invalid["tables"]["account_profiles"][0]
            .as_object_mut()
            .expect("profile")
            .insert("unknown_column".into(), Value::String("bad".into()));

        assert!(db.restore_backup(&invalid).is_err());
        let accounts = db.list_accounts().expect("original account remains");
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].steam_id64, "76561198000000009");
    }
}
