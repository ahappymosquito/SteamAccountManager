//! SQLite migrations and transactional repositories for application data.
use crate::error::{AppError, AppResult};
use crate::models::{
    Account, LocalSteamAccount, PlatformLink, PlatformLinkInput, ProfileInput, TagOption,
};
use chrono::Utc;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use uuid::Uuid;

pub struct Database(pub Mutex<Connection>);

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let tx = conn.transaction()?;
        tx.execute_batch(include_str!("../migrations/001_init.sql"))?;
        tx.commit()?;
        Ok(Self(Mutex::new(conn)))
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
        let mut stmt = conn.prepare("SELECT a.id,a.steam_id64,a.account_name,a.persona_name,a.local_available,a.last_local_seen_at,a.last_switched_at,a.created_at,a.updated_at,p.alias,p.remark,p.group_name,p.color,p.favorite FROM steam_accounts a LEFT JOIN account_profiles p ON p.steam_account_id=a.id ORDER BY p.favorite DESC,COALESCE(a.last_switched_at,a.created_at) DESC")?;
        let rows = stmt.query_map([], |r| {
            Ok(Account {
                id: r.get(0)?,
                steam_id64: r.get(1)?,
                account_name: r.get(2)?,
                persona_name: r.get(3)?,
                local_available: r.get::<_, i64>(4)? != 0,
                last_local_seen_at: r.get(5)?,
                last_switched_at: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
                alias: r.get(9)?,
                remark: r.get(10)?,
                group_name: r.get(11)?,
                color: r.get(12)?,
                favorite: r.get::<_, Option<i64>>(13)?.unwrap_or(0) != 0,
                tags: Vec::new(),
                platform_codes: Vec::new(),
                avatar_path: None,
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
        }
        Ok(accounts)
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
        validate_steam_id(&input.steam_id64)?;
        if input.color.as_deref().is_some_and(|color| {
            !["sky", "cyan", "violet", "mint", "coral", "amber"].contains(&color)
        }) {
            return Err(AppError::new(
                "INVALID_PROFILE_COLOR",
                "账号颜色不在允许的色板中",
            ));
        }
        let mut conn = self.0.lock();
        let tx = conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        let id: Option<String> = tx
            .query_row(
                "SELECT id FROM steam_accounts WHERE steam_id64=?1",
                [&input.steam_id64],
                |r| r.get(0),
            )
            .optional()?;
        let id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
        tx.execute("INSERT INTO steam_accounts(id,steam_id64,local_available,created_at,updated_at) VALUES(?1,?2,0,?3,?3) ON CONFLICT(steam_id64) DO UPDATE SET updated_at=?3",params![id,input.steam_id64,now])?;
        tx.execute("INSERT INTO account_profiles(steam_account_id,alias,remark,group_name,color,favorite) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(steam_account_id) DO UPDATE SET alias=excluded.alias,remark=excluded.remark,group_name=excluded.group_name,color=excluded.color,favorite=excluded.favorite",params![id,input.alias,input.remark,input.group_name,input.color,input.favorite as i64])?;
        tx.execute("DELETE FROM account_tags WHERE steam_account_id=?1", [&id])?;
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
                params![id, actual],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_unavailable_account(&self, id: &str) -> AppResult<String> {
        let mut conn = self.0.lock();
        let tx = conn.transaction()?;
        let steam_id64 = tx
            .query_row(
                "SELECT steam_id64 FROM steam_accounts WHERE id=?1 AND local_available=0",
                [id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new(
                    "ACCOUNT_NOT_REMOVABLE",
                    "只能移除未在 Steam 登录列表中的账号资料",
                )
            })?;
        tx.execute(
            "DELETE FROM steam_accounts WHERE id=?1 AND local_available=0",
            [id],
        )?;
        tx.execute("DELETE FROM platform_accounts WHERE id NOT IN (SELECT platform_account_id FROM account_platform_links)", [])?;
        tx.commit()?;
        Ok(steam_id64)
    }

    pub fn delete_all_unavailable_accounts(&self) -> AppResult<Vec<String>> {
        let mut conn = self.0.lock();
        let tx = conn.transaction()?;
        let steam_ids = {
            let mut stmt = tx.prepare(
                "SELECT steam_id64 FROM steam_accounts WHERE local_available=0 ORDER BY steam_id64",
            )?;
            let ids = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        };
        tx.execute("DELETE FROM steam_accounts WHERE local_available=0", [])?;
        tx.execute("DELETE FROM platform_accounts WHERE id NOT IN (SELECT platform_account_id FROM account_platform_links)", [])?;
        tx.commit()?;
        Ok(steam_ids)
    }

    pub fn list_links(&self, steam_account_id: &str) -> AppResult<Vec<PlatformLink>> {
        let conn = self.0.lock();
        let mut stmt=conn.prepare("SELECT l.id,l.steam_account_id,p.platform_code,p.external_id,p.display_name,p.profile_url,p.remark,p.status,p.last_verified_at FROM account_platform_links l JOIN platform_accounts p ON p.id=l.platform_account_id WHERE l.steam_account_id=?1 ORDER BY p.platform_code")?;
        let links = stmt
            .query_map([steam_account_id], |r| {
                Ok(PlatformLink {
                    id: r.get(0)?,
                    steam_account_id: r.get(1)?,
                    platform_code: r.get(2)?,
                    external_id: r.get(3)?,
                    display_name: r.get(4)?,
                    profile_url: r.get(5)?,
                    remark: r.get(6)?,
                    status: r.get(7)?,
                    last_verified_at: r.get(8)?,
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
        let platform_id: Option<String> = tx
            .query_row(
                "SELECT platform_account_id FROM account_platform_links WHERE id=?1",
                [&link_id],
                |r| r.get(0),
            )
            .optional()?;
        let platform_id = platform_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        tx.execute("INSERT INTO platform_accounts(id,platform_code,external_id,display_name,profile_url,remark,status,binding_method,last_verified_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'manual',CASE WHEN ?7='user_confirmed' THEN ?8 ELSE NULL END,?8,?8) ON CONFLICT(id) DO UPDATE SET platform_code=excluded.platform_code,external_id=excluded.external_id,display_name=excluded.display_name,profile_url=excluded.profile_url,remark=excluded.remark,status=excluded.status,last_verified_at=CASE WHEN excluded.status='user_confirmed' THEN excluded.updated_at ELSE platform_accounts.last_verified_at END,updated_at=excluded.updated_at",params![platform_id,input.platform_code,input.external_id,input.display_name,input.profile_url,input.remark,input.status,now])?;
        tx.execute("INSERT INTO account_platform_links(id,steam_account_id,platform_account_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?4) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at",params![link_id,input.steam_account_id,platform_id,now])?;
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

    fn profile(steam_id64: &str, tags: &[&str]) -> ProfileInput {
        ProfileInput {
            steam_id64: steam_id64.into(),
            alias: Some("主力".into()),
            remark: None,
            group_name: Some("legacy".into()),
            color: Some("sky".into()),
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
        let input = ProfileInput {
            steam_id64: "76561198000000001".into(),
            alias: Some("A".into()),
            remark: None,
            group_name: None,
            color: None,
            favorite: false,
            tags: vec![],
        };
        db.save_profile(&input).expect("one");
        db.save_profile(&input).expect("merge");
        assert_eq!(db.list_accounts().expect("list").len(), 1);
    }

    #[test]
    fn platform_summary_is_assembled_with_accounts() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("platform.db")).expect("db");
        db.save_profile(&profile("76561198000000001", &[]))
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
    fn historical_tags_are_case_insensitive_and_survive_profile_cleanup() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("tags.db")).expect("db");
        db.save_profile(&profile(
            "76561198000000001",
            &["竞技", "竞技", "RANKED", "ranked"],
        ))
        .expect("profile");
        let account = db.list_accounts().expect("accounts").remove(0);
        assert_eq!(account.tags.len(), 2);
        db.delete_unavailable_account(&account.id).expect("cleanup");
        let tags = db.list_tags().expect("history");
        assert_eq!(tags.len(), 2);
        assert!(tags.iter().all(|tag| tag.usage_count == 0));
    }

    #[test]
    fn cleanup_rejects_available_accounts_and_prunes_orphan_platform_records() {
        let temp = tempfile::tempdir().expect("temp");
        let db = Database::open(&temp.path().join("cleanup.db")).expect("db");
        db.sync_accounts(&[local_account("76561198000000001")])
            .expect("scan");
        let available = db.list_accounts().expect("accounts").remove(0);
        assert_eq!(
            db.delete_unavailable_account(&available.id)
                .expect_err("available account is protected")
                .code,
            "ACCOUNT_NOT_REMOVABLE"
        );
        db.save_profile(&profile("76561198000000002", &[]))
            .expect("unavailable profile");
        let unavailable = db
            .list_accounts()
            .expect("accounts")
            .into_iter()
            .find(|account| !account.local_available)
            .expect("unavailable");
        db.save_link(&PlatformLinkInput {
            id: None,
            steam_account_id: unavailable.id.clone(),
            platform_code: "other".into(),
            external_id: Some("legacy".into()),
            display_name: None,
            profile_url: None,
            remark: None,
            status: "unverified".into(),
        })
        .expect("link");
        assert_eq!(
            db.delete_all_unavailable_accounts().expect("bulk cleanup"),
            vec!["76561198000000002"]
        );
        let orphan_count: i64 =
            db.0.lock()
                .query_row("SELECT COUNT(*) FROM platform_accounts", [], |row| {
                    row.get(0)
                })
                .expect("count");
        assert_eq!(orphan_count, 0);
        assert_eq!(db.list_accounts().expect("remaining").len(), 1);
    }
}
