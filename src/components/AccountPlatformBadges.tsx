/** Fixed platform shortcuts and compact legacy-platform badges for account rows. */
import type { Account, PlatformCode } from "../lib/types";

const platformLabels: Record<PlatformCode, string> = {
  perfectworld: "完美平台",
  "5e": "5E",
  faceit: "FACEIT",
  other: "其他",
};
export type QuickPlatformCode = "perfectworld" | "5e";

const platformBadgeDetails = (account: Account, code: PlatformCode) => {
  const rank = account.playerRanks?.find((item) => item.platform === code);
  const summary = account.platformSummaries?.find(
    (item) => item.platformCode === code,
  );
  const ranking = rank?.rankingState === "placement"
    ? ["定级赛", rank.placementMatches === undefined ? undefined : `已打 ${rank.placementMatches} 场`]
    : [
        rank?.rankName,
        rank?.score === undefined ? undefined : Math.round(rank.score).toString(),
      ];
  return [
    summary?.displayName || summary?.externalId,
    ...ranking,
  ]
    .filter(Boolean)
    .join(" · ");
};

export const platformBadgeText = (account: Account, code: PlatformCode) =>
  [platformLabels[code] ?? code, platformBadgeDetails(account, code)]
    .filter(Boolean)
    .join(" · ");

export function AccountPlatformBadges({
  account,
  onSelect,
}: {
  account: Account;
  onSelect?: (code: QuickPlatformCode) => void;
}) {
  const fixedPlatforms: QuickPlatformCode[] = ["perfectworld", "5e"];
  const linkedFixedPlatforms = fixedPlatforms.filter((code) =>
    account.platformCodes.includes(code),
  );
  const legacyPlatforms = (account.platformCodes ?? []).filter(
    (code) => !fixedPlatforms.includes(code as QuickPlatformCode),
  );
  return (
    <div className="platform-badges">
      {linkedFixedPlatforms.map((code) => (
        <button
          type="button"
          className="platform-badge platform-shortcut linked"
          key={code}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(code);
          }}
          aria-label={`编辑${platformLabels[code]}账号资料`}
        >
          <span className="platform-badge-label">{platformLabels[code]}</span>
          {platformBadgeDetails(account, code) && (
            <span className="platform-badge-detail">
              {platformBadgeDetails(account, code)}
            </span>
          )}
        </button>
      ))}
      {legacyPlatforms.map((code) => (
        <span className="platform-badge" key={code}>
          {platformBadgeText(account, code)}
        </span>
      ))}
    </div>
  );
}
