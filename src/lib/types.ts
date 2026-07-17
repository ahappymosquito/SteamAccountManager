/** Shared frontend models matching the validated Tauri command payloads. */
export type Account = { id:string; steamId64:string; accountName?:string; personaName?:string; localAvailable:boolean; lastLocalSeenAt?:string; lastSwitchedAt?:string; createdAt:string; updatedAt:string; alias?:string; remark?:string; groupName?:string; color?:string; favorite:boolean; tags:string[] };
export type ProfileInput = Pick<Account,"steamId64"|"alias"|"remark"|"groupName"|"color"|"favorite"|"tags">;
export type PlatformLink = { id:string; steamAccountId:string; platformCode:string; externalId?:string; displayName?:string; profileUrl?:string; remark?:string; status:"unverified"|"user_confirmed"|"invalid"; lastVerifiedAt?:string };
export type CurrentStatus = { kind:"locally_confirmed"|"inferred"|"steam_not_running"|"unknown"; accountName?:string; steamId64?:string; steamRunning:boolean };
export type StartupSteamResult = { steamPath?:string; scanPerformed:boolean; accountCount:number };
export type SwitchLog = { id:string; steamAccountId?:string; accountName?:string; startedAt:string; finishedAt?:string; result:string; errorMessage?:string };
export type ImportPreview = { added:number; updated:number; skipped:number; blockedFields:string[] };
export type AppError = { code:string; message:string; details?:string };
