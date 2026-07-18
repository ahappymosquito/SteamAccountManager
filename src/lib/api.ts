/** Typed, centralized access to the controlled Tauri IPC surface. */
import { invoke } from "@tauri-apps/api/core";
import type { Account, CurrentStatus, ImportPreview, PlatformApp, PlatformLink, ProfileInput, StartupSteamResult, SteamLoginSession, SteamLoginStatus, SwitchLog, TagOption } from "./types";

export const api = {
  initializeSteam: () => invoke<StartupSteamResult>("initialize_steam"),
  accounts: () => invoke<Account[]>("list_accounts"),
  discoverSteam: () => invoke<string | null>("discover_steam"),
  setSteamPath: (path:string) => invoke<void>("set_steam_path", { path }),
  scan: () => invoke<number>("scan_accounts"),
  status: () => invoke<CurrentStatus>("current_status"),
  saveProfile: (input:ProfileInput) => invoke<void>("save_profile", { input }),
  tags: () => invoke<TagOption[]>("list_tags"),
  beginSteamLogin: () => invoke<SteamLoginSession>("begin_steam_login"),
  steamLoginStatus: (sessionId:string) => invoke<SteamLoginStatus>("get_steam_login_status", { sessionId }),
  cancelSteamLogin: (sessionId:string) => invoke<void>("cancel_steam_login", { sessionId }),
  switchAccount: (steamId64:string) => invoke<{success:boolean;stage:string;message:string}>("switch_account", { steamId64 }),
  links: (steamAccountId:string) => invoke<PlatformLink[]>("list_platform_links", { steamAccountId }),
  saveLink: (input:Omit<PlatformLink,"lastVerifiedAt">) => invoke<void>("save_platform_link", { input }),
  deleteLink: (id:string) => invoke<void>("delete_platform_link", { id }),
  settings: () => invoke<Record<string,unknown>>("get_settings"),
  setSetting: (key:string,value:unknown) => invoke<void>("set_setting", { key,value }),
  logs: () => invoke<SwitchLog[]>("list_switch_logs"),
  clearLogs: () => invoke<void>("clear_switch_logs"),
  platformApps: () => invoke<PlatformApp[]>("list_platform_apps"),
  discoverPlatformApps: () => invoke<PlatformApp[]>("discover_platform_apps"),
  savePlatformApp: (app:PlatformApp) => invoke<void>("save_platform_app", { app }),
  exportData: (includeSettings:boolean) => invoke<Record<string,unknown>>("export_data", { includeSettings }),
  previewImport: (data:unknown) => invoke<ImportPreview>("preview_import", { data }),
  applyImport: (data:unknown,overwrite:boolean) => invoke<ImportPreview>("apply_import", { data,overwrite }),
  restoreBackup: () => invoke<void>("restore_latest_backup")
};
