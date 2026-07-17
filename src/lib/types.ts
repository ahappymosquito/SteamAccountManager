/** Shared frontend models matching the validated Tauri command payloads. */
export type PlatformCode = "perfectworld"|"5e"|"faceit"|"other";
export type Theme = "aurora"|"violet"|"mint"|"glacier";
export type Account = { id:string; steamId64:string; accountName?:string; personaName?:string; lastLocalSeenAt?:string; lastSwitchedAt?:string; createdAt:string; updatedAt:string; alias?:string; remark?:string; groupName?:string; favorite:boolean; tags:string[]; platformCodes:PlatformCode[]; avatarPath?:string };
export type ProfileInput = { accountId:string; alias?:string; remark?:string; favorite:boolean; tags:string[] };
export type TagOption = { name:string; usageCount:number };
export type PlatformLink = { id:string; steamAccountId:string; platformCode:string; externalId?:string; displayName?:string; profileUrl?:string; remark?:string; status:"unverified"|"user_confirmed"|"invalid"; lastVerifiedAt?:string };
export type CurrentStatus = { kind:"locally_confirmed"|"inferred"|"steam_not_running"|"unknown"; accountName?:string; steamId64?:string; steamRunning:boolean };
export type StartupSteamResult = { steamPath?:string; scanPerformed:boolean; accountCount:number };
export type SwitchLog = { id:string; steamAccountId?:string; accountName?:string; startedAt:string; finishedAt?:string; result:string; errorMessage?:string };
export type ImportPreview = { added:number; updated:number; skipped:number; blockedFields:string[] };
export type AppError = { code:string; message:string; details?:string };
export type SteamLoginSession = { id:string; startedAt:string };
export type SteamLoginStatus = { state:"pending"|"completed"|"timed_out"|"failed"; accountId?:string; message?:string };
