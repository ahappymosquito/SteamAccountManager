/** Deterministic account filtering, custom ordering, and 5E ranking order. */
import type { Account, PlatformCode } from "./types";

export type AccountPlatformFilter = "" | PlatformCode | "unlinked";
export type AccountSort = "custom" | "score_desc" | "score_asc";

export function filterAccounts(accounts: Account[], query: string, favoriteOnly = false, platform: AccountPlatformFilter = "", selectedTags: string[] = []) {
  const normalized = query.trim().toLocaleLowerCase();
  return accounts.filter((account) =>
    (!favoriteOnly || account.favorite)
    && (!platform || (platform === "unlinked" ? account.platformCodes.length === 0 : account.platformCodes.includes(platform)))
    && selectedTags.every((tag) => account.tags.some((accountTag) => accountTag.toLocaleLowerCase() === tag.toLocaleLowerCase()))
    && (!normalized || [account.alias, account.personaName, account.accountName, account.remark, ...account.tags].some((value) => value?.toLocaleLowerCase().includes(normalized)))
  );
}

export const fiveERankingKey = (account: Account) => {
  const rank = account.playerRanks?.find((item) => item.platform === "5e");
  if (rank?.rankingState === "ranked") {
    return { group: 1, score: rank.score } as const;
  }
  return {
    group: 0,
    score:
      rank?.rankingState === "placement"
        ? rank.previousSeasonScore
        : undefined,
  } as const;
};

export function sortAccounts(accounts: Account[], sort: AccountSort) {
  if (sort === "custom") return [...accounts];
  return accounts
    .map((account, index) => ({
      account,
      index,
      ranking: fiveERankingKey(account),
    }))
    .sort((left, right) => {
      if (left.ranking.group !== right.ranking.group) {
        return left.ranking.group - right.ranking.group;
      }
      const leftScore = left.ranking.score;
      const rightScore = right.ranking.score;
      if (leftScore === undefined && rightScore === undefined) {
        return left.index - right.index;
      }
      if (leftScore === undefined) return -1;
      if (rightScore === undefined) return 1;
      const difference = sort === "score_desc"
        ? rightScore - leftScore
        : leftScore - rightScore;
      return difference || left.index - right.index;
    })
    .map(({ account }) => account);
}

export function normalizeAccountOrder(accounts: Account[], saved: unknown) {
  const validIds = new Set(accounts.map((account) => account.steamId64));
  const seen = new Set<string>();
  const ordered = Array.isArray(saved)
    ? saved.filter(
        (value): value is string =>
          typeof value === "string" &&
          validIds.has(value) &&
          !seen.has(value) &&
          Boolean(seen.add(value)),
      )
    : [];
  return [
    ...ordered,
    ...accounts
      .map((account) => account.steamId64)
      .filter((steamId64) => !seen.has(steamId64)),
  ];
}

export function applyAccountOrder(accounts: Account[], order: string[]) {
  const positions = new Map(order.map((steamId64, index) => [steamId64, index]));
  return accounts
    .map((account, index) => ({ account, index }))
    .sort(
      (left, right) =>
        (positions.get(left.account.steamId64) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(right.account.steamId64) ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index,
    )
    .map(({ account }) => account);
}
