/** Typed, centralized access to the controlled Tauri IPC surface. */
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Account, AccountCfgAssignment, CfgCaptureResult, CfgDeployReport, CfgProfile, CfgRuntimeAccountSummary, Cs2Config, CurrentStatus, DownloadProgress, ImportPreview, PlatformApp, PlatformCredentialStatus, PlatformLink, PlayerSnapshot, ProfileInput, RestoreSelection, SoftwareStatus, StartupSteamResult, SteamLoginSession, SteamLoginStatus, SwitchLog, SwitchProgress, SwitchResult, TagOption, TravelIdentity, TravelImportResult, Ts3Identity, UpdateInfo, UpdateProgress, VaultReplaceResult } from "./types";

export const api = {
  initializeSteam: () => invoke<StartupSteamResult>("initialize_steam"),
  accounts: () => invoke<Account[]>("list_accounts"),
  discoverSteam: () => invoke<string | null>("discover_steam"),
  setSteamPath: (path:string) => invoke<void>("set_steam_path", { path }),
  scan: () => invoke<number>("scan_accounts"),
  refreshSteamProfileMedia: (force=false) => invoke<number>("refresh_steam_profile_media",{force}),
  status: () => invoke<CurrentStatus>("current_status"),
  saveProfile: (input:ProfileInput) => invoke<void>("save_profile", { input }),
  tags: () => invoke<TagOption[]>("list_tags"),
  beginSteamLogin: () => invoke<SteamLoginSession>("begin_steam_login"),
  steamLoginStatus: (sessionId:string) => invoke<SteamLoginStatus>("get_steam_login_status", { sessionId }),
  cancelSteamLogin: (sessionId:string) => invoke<void>("cancel_steam_login", { sessionId }),
  switchAccount: (steamId64:string,onProgress:(progress:SwitchProgress)=>void) => {
    const onEvent = new Channel<SwitchProgress>();
    onEvent.onmessage = onProgress;
    return invoke<SwitchResult>("switch_account", { steamId64,onEvent });
  },
  links: (steamAccountId:string) => invoke<PlatformLink[]>("list_platform_links", { steamAccountId }),
  saveLink: (input:Omit<PlatformLink,"lastVerifiedAt">) => invoke<void>("save_platform_link", { input }),
  deleteLink: (id:string) => invoke<void>("delete_platform_link", { id }),
  playerData: (platformLinkId:string,forceRefresh=false) => invoke<PlayerSnapshot>("query_player_data", { platformLinkId,forceRefresh }),
  autoLinkPerfectWorld: (steamAccountId:string,forceRefresh=false) => invoke<PlayerSnapshot>("auto_link_perfectworld", { steamAccountId,forceRefresh }),
  savePlatformCredential: (platformCode:string,token?:string) => invoke<void>("save_platform_credential", { platformCode,token:token||null }),
  platformCredentialStatus: (platformCode:string) => invoke<PlatformCredentialStatus>("get_platform_credential_status", { platformCode }),
  settings: () => invoke<Record<string,unknown>>("get_settings"),
  setSetting: (key:string,value:unknown) => invoke<void>("set_setting", { key,value }),
  logs: () => invoke<SwitchLog[]>("list_switch_logs"),
  clearLogs: () => invoke<void>("clear_switch_logs"),
  platformApps: () => invoke<PlatformApp[]>("list_platform_apps"),
  discoverPlatformApps: () => invoke<PlatformApp[]>("discover_platform_apps"),
  discoverCs2Configs: () => invoke<Cs2Config[]>("discover_cs2_configs"),
  cfgProfiles: () => invoke<CfgProfile[]>("list_cfg_profiles"),
  activeCfgProfile: () => invoke<CfgProfile>("get_active_cfg_profile"),
  setActiveCfgProfile: (id:string) => invoke<CfgProfile>("set_active_cfg_profile",{id}),
  createCfgProfile: (name:string,fileName:string,content="") => invoke<CfgProfile>("create_cfg_profile",{name,fileName,content}),
  importCfgProfile: (path:string) => invoke<CfgProfile>("import_cfg_profile",{path}),
  saveCfgProfile: (id:string,name:string,content:string) => invoke<void>("save_cfg_profile",{id,name,content}),
  exportCfgProfile: (id:string,path:string) => invoke<string>("export_cfg_profile",{id,path}),
  readCfgDefinitionFile: (path:string) => invoke<string>("read_cfg_definition_file",{path}),
  writeCfgDefinitionFile: (path:string,content:string) => invoke<string>("write_cfg_definition_file",{path,content}),
  deleteCfgProfile: (id:string) => invoke<void>("delete_cfg_profile",{id}),
  cfgAssignments: () => invoke<AccountCfgAssignment[]>("list_cfg_assignments"),
  assignCfgProfile: (steamAccountId:string,profileId?:string) => invoke<void>("assign_cfg_profile",{steamAccountId,profileId:profileId||null}),
  captureRuntimeCfgs: (force=false) => invoke<CfgCaptureResult>("capture_runtime_cfgs",{force}),
  runtimeCfgAccounts: () => invoke<CfgRuntimeAccountSummary[]>("list_runtime_cfg_accounts"),
  openRuntimeCfgSnapshot: (id:string) => invoke<CfgProfile>("open_runtime_cfg_snapshot",{id}),
  applyRuntimeCfgSnapshot: (id:string) => invoke<CfgProfile>("apply_runtime_cfg_snapshot",{id}),
  exportCfgText: (path:string,content:string) => invoke<string>("export_cfg_text",{path,content}),
  travelIdentities: () => invoke<TravelIdentity[]>("list_travel_identities"),
  exportTravelPack: (path:string) => invoke<TravelImportResult>("export_travel_pack_file",{path}),
  importTravelPack: (path:string) => invoke<TravelImportResult>("import_travel_pack_file",{path}),
  ts3Identities: () => invoke<Ts3Identity[]>("list_ts3_identities"),
  rememberedVaultName: () => invoke<string | null>("remembered_vault_name"),
  uploadTravelVault: (name:string, pin:string) => invoke<string>("upload_travel_vault",{name, pin}),
  downloadTravelVault: (name:string, pin:string) => invoke<TravelIdentity[]>("download_travel_vault",{name, pin}),
  replaceTravelVault: (name:string, pin:string) => invoke<VaultReplaceResult>("replace_travel_vault",{name, pin}),
  deployTravelCfgs: () => invoke<CfgDeployReport>("deploy_travel_cfgs"),
  softwareStatuses: () => invoke<SoftwareStatus[]>("list_software_statuses"),
  downloadProgress: () => invoke<DownloadProgress[]>("list_download_progress"),
  openOfficialUrl: (code:string) => invoke<void>("open_official_url",{code}),
  startSoftwareDownload: (code:string) => invoke<void>("start_software_download",{code}),
  launchSoftware: (code:string) => invoke<void>("launch_software",{code}),
  savePlatformApp: (app:PlatformApp) => invoke<void>("save_platform_app", { app }),
  exportBackupFile: (path:string) => invoke<ImportPreview>("export_backup_file", { path }),
  previewBackupFile: (path:string) => invoke<ImportPreview>("preview_backup_file", { path }),
  restoreBackupFile: (path:string,selection:RestoreSelection) => invoke<ImportPreview>("restore_backup_file", { path,selection }),
  restoreSteamBackup: () => invoke<void>("restore_latest_steam_backup"),
  checkAppUpdate: () => invoke<UpdateInfo | null>("check_app_update"),
  installAppUpdate: (onProgress:(progress:UpdateProgress)=>void) => {
    const onEvent = new Channel<UpdateProgress>();
    onEvent.onmessage = onProgress;
    return invoke<void>("install_app_update", { onEvent });
  }
};
