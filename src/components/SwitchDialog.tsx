/** Explicit Steam account switch confirmation and progress surface. */
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import type { Account, CurrentStatus, SwitchProgress } from "../lib/types";
import { currentStatusName } from "./CurrentSteamStatus";

type SwitchDialogProps = {
  account: Account;
  status?: CurrentStatus;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onConfirm: (onProgress: (progress: SwitchProgress) => void) => Promise<void>;
};

export function SwitchDialog({
  account,
  status,
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
            将关闭并按目标账号重新启动 Steam。已安装 CS2
            时会先同步所选 CFG，但不会自动启动 CS2。
            {account.platformCodes.includes("5e")
              ? "此账号已关联 5E，确认目标 Steam 账号登录后会启动或重启 5E。"
              : "此账号未关联 5E，不会启动第三方平台。"}
            工具只能切换本机仍然有效、已被 Steam
            记住的登录状态；状态失效时仍需在 Steam 官方客户端完成登录或 Steam Guard 验证。
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
