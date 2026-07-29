/** Compact platform identity, rank and score badges for Steam account rows. */
import type { Account, PlatformCode } from "../lib/types";

const platformLabels: Record<PlatformCode, string> = {
  perfectworld: "完美世界",
  "5e": "5E",
  faceit: "FACEIT",
  other: "其他",
};

export const platformBadgeText = (account: Account, code: PlatformCode) => {
  const rank = account.playerRanks?.find((item) => item.platform === code);
  return [
    platformLabels[code] ?? code,
    rank?.rankName,
    rank?.score === undefined ? undefined : Math.round(rank.score).toString(),
  ]
    .filter(Boolean)
    .join(" · ");
};

export function AccountPlatformBadges({ account }: { account: Account }) {
  return (
    <div className="platform-badges">
      {(account.platformCodes ?? []).map((code) => (
        <span className="platform-badge" key={code}>
          {platformBadgeText(account, code)}
        </span>
      ))}
      {!(account.platformCodes ?? []).length && (
        <span className="platform-badge muted">未关联平台</span>
      )}
    </div>
  );
}
