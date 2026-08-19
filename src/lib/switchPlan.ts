/** Copy and planned side effects for a Steam account switch. */
import type { Account } from "./types";

export const SWITCH_LAUNCH_PLATFORMS = ["5e", "perfectworld"] as const;
export type SwitchLaunchPlatform = (typeof SWITCH_LAUNCH_PLATFORMS)[number];

const platformLabel: Record<SwitchLaunchPlatform, string> = {
  "5e": "5E",
  perfectworld: "完美",
};

export function linkedLaunchPlatforms(
  account: Pick<Account, "platformCodes">,
): SwitchLaunchPlatform[] {
  return SWITCH_LAUNCH_PLATFORMS.filter((code) =>
    account.platformCodes.includes(code),
  );
}

export function switchDialogDescription(
  account: Pick<Account, "platformCodes">,
  steamOnlySwitch: boolean,
): string {
  const prefix =
    "将关闭并按目标账号重新启动 Steam。已安装 CS2 时会先同步所选 CFG，但不会自动启动 CS2。";
  if (steamOnlySwitch) {
    return `${prefix}当前为「只切 Steam」，不会启动 5E 或完美平台。`;
  }
  const linked = linkedLaunchPlatforms(account);
  if (linked.length === 0) {
    return `${prefix}此账号未关联 5E 或完美，不会启动第三方平台。`;
  }
  const names = linked.map((code) => platformLabel[code]).join("、");
  return `${prefix}此账号已关联 ${names}，确认目标 Steam 账号登录后会启动或重启这些平台。`;
}
