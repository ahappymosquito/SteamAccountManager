/** Deterministic account filtering for search, status and platform linkage. */
import type { Account, PlatformCode } from "./types";

export type AccountPlatformFilter = "" | PlatformCode | "unlinked";

export function filterAccounts(accounts: Account[], query: string, localOnly = false, favoriteOnly = false, platform: AccountPlatformFilter = "") {
  const normalized = query.trim().toLocaleLowerCase();
  return accounts.filter((account) =>
    (!localOnly || account.localAvailable)
    && (!favoriteOnly || account.favorite)
    && (!platform || (platform === "unlinked" ? account.platformCodes.length === 0 : account.platformCodes.includes(platform)))
    && (!normalized || [account.alias, account.personaName, account.accountName, account.remark, ...account.tags].some((value) => value?.toLocaleLowerCase().includes(normalized)))
  );
}
