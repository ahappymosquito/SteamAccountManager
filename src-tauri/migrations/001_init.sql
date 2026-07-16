-- Initial application database schema and indexes.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS steam_accounts (id TEXT PRIMARY KEY, steam_id64 TEXT NOT NULL UNIQUE, account_name TEXT, persona_name TEXT, local_available INTEGER NOT NULL DEFAULT 0 CHECK(local_available IN (0,1)), last_local_seen_at TEXT, last_switched_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_profiles (steam_account_id TEXT PRIMARY KEY, alias TEXT, remark TEXT, group_name TEXT, color TEXT, favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)), FOREIGN KEY (steam_account_id) REFERENCES steam_accounts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_tags (steam_account_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (steam_account_id, tag_id), FOREIGN KEY (steam_account_id) REFERENCES steam_accounts(id) ON DELETE CASCADE, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS platform_accounts (id TEXT PRIMARY KEY, platform_code TEXT NOT NULL, external_id TEXT, display_name TEXT, profile_url TEXT, remark TEXT, status TEXT NOT NULL DEFAULT 'unverified', binding_method TEXT NOT NULL DEFAULT 'manual', last_verified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_platform_links (id TEXT PRIMARY KEY, steam_account_id TEXT NOT NULL, platform_account_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (steam_account_id) REFERENCES steam_accounts(id) ON DELETE CASCADE, FOREIGN KEY (platform_account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE, UNIQUE(steam_account_id, platform_account_id));
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS switch_logs (id TEXT PRIMARY KEY, steam_account_id TEXT, account_name TEXT, started_at TEXT NOT NULL, finished_at TEXT, result TEXT NOT NULL, error_message TEXT, FOREIGN KEY (steam_account_id) REFERENCES steam_accounts(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS platform_apps (platform_code TEXT PRIMARY KEY, name TEXT NOT NULL, executable_path TEXT NOT NULL, arguments_json TEXT NOT NULL DEFAULT '[]', working_directory TEXT, prelaunch_check INTEGER NOT NULL DEFAULT 1 CHECK(prelaunch_check IN (0,1)), updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_steam_accounts_name ON steam_accounts(account_name);
CREATE INDEX IF NOT EXISTS idx_steam_accounts_switched ON steam_accounts(last_switched_at);
CREATE INDEX IF NOT EXISTS idx_profiles_group ON account_profiles(group_name);
CREATE INDEX IF NOT EXISTS idx_profiles_favorite ON account_profiles(favorite);
CREATE INDEX IF NOT EXISTS idx_platform_code_external ON platform_accounts(platform_code, external_id);
