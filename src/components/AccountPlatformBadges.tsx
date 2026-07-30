/** Fixed, compact Perfect World and 5E account shortcuts for Steam rows. */
import type { Account, PlatformCode } from "../lib/types";

const platformLabels: Record<PlatformCode, string> = {
  perfectworld: "完美",
  "5e": "5E",
  faceit: "FACEIT",
  other: "其他",
};
export type QuickPlatformCode = "perfectworld" | "5e";

const platformAccountName = (account: Account, code: PlatformCode) => {
  const summary = account.platformSummaries?.find(
    (item) => item.platformCode === code,
  );
  return summary?.displayName || summary?.externalId;
};

const fiveERankingText = (account: Account) => {
  const rank = account.playerRanks?.find((item) => item.platform === "5e");
  if (rank?.rankingState === "placement") {
    return `未定级${
      rank.placementMatches === undefined ? "" : ` · 已打 ${rank.placementMatches} 场`
    }`;
  }
  if (rank?.rankingState === "ranked" && rank.score !== undefined) {
    return Math.round(rank.score).toString();
  }
  return "未定级";
};

export const platformBadgeText = (account: Account, code: PlatformCode) =>
  [platformLabels[code] ?? code, platformAccountName(account, code)]
    .filter(Boolean)
    .join(" · ");

export function AccountPlatformBadges({
  account,
  onSelect,
  showFiveEScore = false,
}: {
  account: Account;
  onSelect?: (code: QuickPlatformCode) => void;
  showFiveEScore?: boolean;
}) {
  const fixedPlatforms: QuickPlatformCode[] = ["perfectworld", "5e"];
  return (
    <div className="platform-badges">
      {fixedPlatforms.map((code) => {
        const linked = account.platformCodes.includes(code);
        const name = platformAccountName(account, code);
        const title = [platformLabels[code], name].filter(Boolean).join(" · ");
        return (
          <button
            type="button"
            className={`platform-badge platform-shortcut${
              linked ? " linked" : " unlinked"
            }`}
            key={code}
            title={title}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(code);
            }}
            aria-label={`编辑${platformLabels[code]}账号资料`}
          >
            <span className="platform-badge-label">{platformLabels[code]}</span>
            {linked && name && (
              <span className="platform-badge-detail">{name}</span>
            )}
            {linked && code === "5e" && showFiveEScore && (
              <span className="platform-score">{fiveERankingText(account)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
