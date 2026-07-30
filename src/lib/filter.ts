/** Deterministic account filtering for search, status and platform linkage. */
import type { Account, PlatformCode } from "./types";

export type AccountPlatformFilter = "" | PlatformCode | "unlinked";
export type AccountSort = "score_desc" | "score_asc" | "recent";

export function filterAccounts(accounts: Account[], query: string, favoriteOnly = false, platform: AccountPlatformFilter = "", selectedTags: string[] = []) {
  const normalized = query.trim().toLocaleLowerCase();
  return accounts.filter((account) =>
    (!favoriteOnly || account.favorite)
    && (!platform || (platform === "unlinked" ? account.platformCodes.length === 0 : account.platformCodes.includes(platform)))
    && selectedTags.every((tag) => account.tags.some((accountTag) => accountTag.toLocaleLowerCase() === tag.toLocaleLowerCase()))
    && (!normalized || [account.alias, account.personaName, account.accountName, account.remark, ...account.tags].some((value) => value?.toLocaleLowerCase().includes(normalized)))
  );
}

export const effectiveFiveEScore = (account: Account) => {
  const rank = account.playerRanks?.find((item) => item.platform === "5e");
  if (rank?.rankingState === "ranked") return rank.score;
  if (rank?.rankingState === "placement") return rank.previousSeasonScore;
  return undefined;
};

export function sortAccounts(accounts: Account[], sort: AccountSort) {
  if (sort === "recent") return [...accounts];
  return accounts
    .map((account, index) => ({ account, index, score: effectiveFiveEScore(account) }))
    .sort((left, right) => {
      if (left.score === undefined && right.score === undefined) return left.index - right.index;
      if (left.score === undefined) return 1;
      if (right.score === undefined) return -1;
      const difference = sort === "score_desc"
        ? right.score - left.score
        : left.score - right.score;
      return difference || left.index - right.index;
    })
    .map(({ account }) => account);
}
