/** Fixed platform shortcuts and compact legacy-platform badges for account rows. */
import type { Account, PlatformCode } from "../lib/types";

const platformLabels: Record<PlatformCode, string> = {
  perfectworld: "完美平台",
  "5e": "5E",
  faceit: "FACEIT",
  other: "其他",
};
export type QuickPlatformCode = "perfectworld" | "5e";

export const platformBadgeText = (account: Account, code: PlatformCode) => {
  const rank = account.playerRanks?.find((item) => item.platform === code);
  const summary = account.platformSummaries?.find(
    (item) => item.platformCode === code,
  );
  return [
    platformLabels[code] ?? code,
    summary?.displayName || summary?.externalId,
    rank?.rankName,
    rank?.score === undefined ? undefined : Math.round(rank.score).toString(),
  ]
    .filter(Boolean)
    .join(" · ");
};

export function AccountPlatformBadges({
  account,
  onSelect,
}: {
  account: Account;
  onSelect?: (code: QuickPlatformCode) => void;
}) {
  const fixedPlatforms: QuickPlatformCode[] = ["perfectworld", "5e"];
  const legacyPlatforms = (account.platformCodes ?? []).filter(
    (code) => !fixedPlatforms.includes(code as QuickPlatformCode),
  );
  return (
    <div className="platform-badges">
      {fixedPlatforms.map((code) => (
        <button
          type="button"
          className={`platform-badge platform-shortcut${
            account.platformCodes.includes(code) ? "" : " muted"
          }`}
          key={code}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(code);
          }}
          aria-label={`编辑${platformLabels[code]}账号资料`}
        >
          {account.platformCodes.includes(code)
            ? platformBadgeText(account, code)
            : `${platformLabels[code]} · 待填写`}
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
