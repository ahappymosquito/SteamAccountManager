/** Current local Steam identity label with persona-name-first presentation. */
import type { CurrentStatus } from "../lib/types";

const statusLabels: Record<CurrentStatus["kind"], string> = {
  locally_confirmed: "本地确认",
  inferred: "当前推测",
  steam_not_running: "Steam 未运行",
  unknown: "状态未知",
};

export const currentStatusName = (status?: CurrentStatus) =>
  status?.personaName || status?.accountName;

export function CurrentSteamStatus({ status }: { status?: CurrentStatus }) {
  return (
    <div className={`status ${status?.kind ?? "unknown"}`}>
      <span />
      {status ? statusLabels[status.kind] : "正在检查"}
      {currentStatusName(status) && <strong>{currentStatusName(status)}</strong>}
    </div>
  );
}
