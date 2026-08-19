/** Switch confirmation copy for the steam-only toggle and linked platforms. */
import { describe, expect, it } from "vitest";
import {
  linkedLaunchPlatforms,
  switchDialogDescription,
} from "./switchPlan";

const account = (platformCodes: Array<"5e" | "perfectworld" | "faceit">) => ({
  platformCodes,
});

describe("linkedLaunchPlatforms", () => {
  it("only returns 5E and Perfect World links", () => {
    expect(
      linkedLaunchPlatforms(account(["faceit", "5e", "perfectworld"])),
    ).toEqual(["5e", "perfectworld"]);
    expect(linkedLaunchPlatforms(account([]))).toEqual([]);
  });
});

describe("switchDialogDescription", () => {
  it("says steam-only mode will not launch platforms", () => {
    expect(switchDialogDescription(account(["5e", "perfectworld"]), true)).toContain(
      "当前为「只切 Steam」，不会启动 5E 或完美平台",
    );
    expect(switchDialogDescription(account(["5e"]), true)).not.toContain(
      "会启动或重启 5E",
    );
  });

  it("lists linked 5E and Perfect World when the toggle is off", () => {
    expect(switchDialogDescription(account(["5e"]), false)).toContain(
      "此账号已关联 5E，确认目标 Steam 账号登录后会启动或重启这些平台",
    );
    expect(
      switchDialogDescription(account(["perfectworld", "5e"]), false),
    ).toContain("此账号已关联 5E、完美");
  });

  it("says unlinked accounts will not launch platforms", () => {
    expect(switchDialogDescription(account([]), false)).toContain(
      "此账号未关联 5E 或完美，不会启动第三方平台",
    );
  });
});
