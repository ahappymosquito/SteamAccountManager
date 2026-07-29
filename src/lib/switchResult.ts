/** Converts structured account-switch outcomes into user-facing notices. */
import type { SwitchResult } from "./types";
import type { NoticeKind } from "../store";

export const switchResultNotice = (
  result: SwitchResult,
): { kind: NoticeKind; text: string } =>
  result.warnings.length
    ? { kind: "warning", text: result.warnings.join("；") }
    : {
        kind: "success",
        text: result.message || "Steam 账号切换完成",
      };
