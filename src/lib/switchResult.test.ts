/** Structured switch-result notification regression tests. */
import { describe, expect, it } from "vitest";
import { switchResultNotice } from "./switchResult";

describe("switchResultNotice", () => {
  it("surfaces a linked-platform partial failure as a warning", () => {
    expect(
      switchResultNotice({
        success: true,
        stage: "completed_with_warning",
        message: "Steam 已切换",
        warnings: ["Steam 账号已切换，但 5E 未能启动或重启：未配置"],
      }),
    ).toEqual({
      kind: "warning",
      text: "Steam 账号已切换，但 5E 未能启动或重启：未配置",
    });
  });
});
