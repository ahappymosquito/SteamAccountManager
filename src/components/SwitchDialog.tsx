/** Explicit Steam account switch confirmation and progress surface. */
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { switchDialogDescription } from "../lib/switchPlan";
import type { Account, CurrentStatus, SwitchProgress } from "../lib/types";
import { currentStatusName } from "./CurrentSteamStatus";

type SwitchDialogProps = {
  account: Account;
  status?: CurrentStatus;
  steamOnlySwitch: boolean;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onConfirm: (onProgress: (progress: SwitchProgress) => void) => Promise<void>;
};

export function SwitchDialog({
  account,
  status,
  steamOnlySwitch,
  open,
  onOpenChange,
  onConfirm,
}: SwitchDialogProps) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SwitchProgress>();
  const confirm = async () => {
    setBusy(true);
    setProgress({ stage: "closing_steam", message: "正在关闭 Steam" });
    try {
      await onConfirm(setProgress);
      onOpenChange(false);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  };

  const handleOpenChange = (value: boolean) => {
    if (!busy) onOpenChange(value);
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content
          className="dialog compact"
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
        >
          <AlertDialog.Title>
            <AlertTriangle className="warning-icon" />
            确认切换 Steam 账号
          </AlertDialog.Title>
          <AlertDialog.Description>
            {switchDialogDescription(account, steamOnlySwitch)}
          </AlertDialog.Description>
          <dl className="facts">
            <div>
              <dt>当前状态</dt>
              <dd>
                {status?.kind === "locally_confirmed"
                  ? currentStatusName(status)
                  : "未确认"}
              </dd>
            </div>
            <div>
              <dt>目标账号</dt>
              <dd>
                {account.personaName || account.accountName || "未命名账号"}
              </dd>
            </div>
          </dl>
          {busy && (
            <div className="progress" role="status" aria-live="polite">
              <span className="spinner" />
              {progress?.message || "正在切换 Steam 账号"}
            </div>
          )}
          <footer>
            <AlertDialog.Cancel className="button secondary" disabled={busy}>
              取消
            </AlertDialog.Cancel>
            <button
              className="button danger-fill"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? "正在切换" : "确认切换"}
            </button>
          </footer>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
