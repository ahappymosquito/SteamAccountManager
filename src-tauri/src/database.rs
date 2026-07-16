//! SQLite migrations and transactional repositories for application data.
use crate::error::{AppError, AppResult};
use crate::models::{Account, LocalSteamAccount, PlatformLink, PlatformLinkInput, ProfileInput};
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
            })
        })?;
        let mut accounts: Vec<Account> = rows.collect::<Result<_, _>>()?;
        for account in &mut accounts {
            let mut tags = conn.prepare("SELECT t.name FROM tags t JOIN account_tags at ON at.tag_id=t.id WHERE at.steam_account_id=?1 ORDER BY t.name")?;
            account.tags = tags
                .query_map([&account.id], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
        }
        Ok(accounts)
    }

    pub fn save_profile(&self, input: &ProfileInput) -> AppResult<()> {
        validate_steam_id(&input.steam_id64)?;
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
            let tag_id = Uuid::new_v4().to_string();
            tx.execute("INSERT INTO tags(id,name,created_at) VALUES(?1,?2,?3) ON CONFLICT(name) DO NOTHING",params![tag_id,name,now])?;
            let actual: String =
                tx.query_row("SELECT id FROM tags WHERE name=?1", [name], |r| r.get(0))?;
            tx.execute(
                "INSERT OR IGNORE INTO account_tags(steam_account_id,tag_id) VALUES(?1,?2)",
                params![id, actual],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_profile(&self, id: &str) -> AppResult<()> {
        self.0
            .lock()
            .execute("DELETE FROM steam_accounts WHERE id=?1", [id])?;
        Ok(())
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
}
