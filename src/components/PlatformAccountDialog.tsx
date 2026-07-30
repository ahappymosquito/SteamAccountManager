/** Independent Perfect World and 5E account editor opened from account-row shortcuts. */
import * as Dialog from "@radix-ui/react-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, Eye, EyeOff, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import type { Account, PlatformLink } from "../lib/types";
import type { QuickPlatformCode } from "./AccountPlatformBadges";

const platformLabels: Record<QuickPlatformCode, string> = {
  perfectworld: "完美",
  "5e": "5E",
};

const blankLink = (
  account: Account,
  platformCode: QuickPlatformCode,
): Omit<PlatformLink, "lastVerifiedAt"> => ({
  id: "",
  steamAccountId: account.id,
  platformCode,
  externalId: platformCode === "perfectworld" ? account.steamId64 : "",
  displayName: "",
  profileUrl: "",
  loginAccount: "",
  loginPassword: "",
  remark: "",
  status: "unverified",
});

const editableLink = (
  account: Account,
  platformCode: QuickPlatformCode,
  link?: PlatformLink,
) =>
  link
    ? {
        id: link.id,
        steamAccountId: link.steamAccountId,
        platformCode: link.platformCode,
        externalId: link.externalId || "",
        displayName: link.displayName || link.externalId || "",
        profileUrl: link.profileUrl || "",
        loginAccount: link.loginAccount || "",
        loginPassword: link.loginPassword || "",
        remark: link.remark || "",
        status: link.status,
      }
    : blankLink(account, platformCode);

export function PlatformAccountDialog({
  account,
  platform,
  open,
  onOpenChange,
  notify,
  onChanged,
}: {
  account: Account;
  platform: QuickPlatformCode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notify: (kind: "success" | "error", text: string) => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(blankLink(account, platform));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setPasswordVisible(false);
    setHint("");
    void api
      .links(account.id)
      .then((links) => {
        if (!active) return;
        setDraft(
          editableLink(
            account,
            platform,
            links.find((link) => link.platformCode === platform),
          ),
        );
      })
      .catch((error) => {
        if (active) {
          notify(
            "error",
            (error as { message?: string }).message || "平台资料加载失败",
          );
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, account.id, platform]);

  const copyValue = async (label: string, value?: string) => {
    if (!value) return;
    try {
      await writeText(value);
      notify("success", `${label}已复制`);
    } catch {
      notify("error", `${label}复制失败`);
    }
  };

  const save = async () => {
    const nickname = draft.displayName?.trim();
    if (platform === "5e" && !nickname) {
      notify("error", "请填写用于查询的 5E 用户名");
      return;
    }
    setSaving(true);
    setHint("");
    try {
      const wasEditing = Boolean(draft.id);
      const id = draft.id || crypto.randomUUID();
      await api.saveLink({
        ...draft,
        id,
        platformCode: platform,
        externalId:
          platform === "5e" ? nickname : account.steamId64,
        displayName: nickname || undefined,
        profileUrl: draft.profileUrl?.trim() || undefined,
        loginAccount: draft.loginAccount?.trim() || undefined,
        loginPassword: draft.loginPassword || undefined,
        remark: draft.remark?.trim() || undefined,
        status: "unverified",
      });
      if (platform === "5e") {
        try {
          await api.playerData(id, true);
          notify(
            "success",
            wasEditing ? "5E 玩家已验证并更新" : "5E 玩家已验证并关联",
          );
        } catch (error) {
          notify(
            "error",
            `资料已保存，但玩家查询失败：${
              (error as { message?: string }).message || "无法查询玩家"
            }`,
          );
        }
      } else {
        try {
          const status = await api.platformCredentialStatus("perfectworld");
          if (status.configured) {
            await api.autoLinkPerfectWorld(account.id, true);
            setHint("已使用 SteamID 查询完美平台资料。");
          } else {
            setHint("资料已保存；配置 Access Token 后可按 SteamID 查询战绩。");
          }
          notify("success", wasEditing ? "完美平台资料已更新" : "完美平台资料已保存");
        } catch (error) {
          setHint(
            (error as { message?: string }).message ||
              "资料已保存，但完美平台查询暂时不可用",
          );
          notify("error", "资料已保存，但完美平台查询失败");
        }
      }
      onChanged();
      const links = await api.links(account.id);
      setDraft(
        editableLink(
          account,
          platform,
          links.find((link) => link.platformCode === platform),
        ),
      );
    } catch (error) {
      notify(
        "error",
        (error as { message?: string }).message || "平台资料保存失败",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft.id || !confirm(`确认清除${platformLabels[platform]}平台资料？`)) {
      return;
    }
    try {
      await api.deleteLink(draft.id);
      onChanged();
      notify("success", `${platformLabels[platform]}平台资料已清除`);
      onOpenChange(false);
    } catch (error) {
      notify(
        "error",
        (error as { message?: string }).message || "平台资料清除失败",
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog platform-account-dialog">
          <header className="dialog-heading">
            <div>
              <Dialog.Title>编辑{platformLabels[platform]}账号</Dialog.Title>
              <Dialog.Description>
                {account.personaName || "未命名 Steam 账号"}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭平台编辑">
              <X />
            </Dialog.Close>
          </header>
          {loading ? (
            <div className="platform-dialog-loading" aria-busy="true">
              正在加载平台资料…
            </div>
          ) : (
            <div className="platform-editor platform-dialog-form">
              <label>
                平台用户名
                <input
                  value={draft.displayName || ""}
                  onChange={(event) =>
                    setDraft({ ...draft, displayName: event.target.value })
                  }
                  placeholder={
                    platform === "5e"
                      ? "用于查询 5E 玩家数据"
                      : "用于展示和人工识别"
                  }
                  autoFocus
                />
              </label>
              <label>
                登录账号
                <div className="credential-input-row">
                  <input
                    value={draft.loginAccount || ""}
                    onChange={(event) =>
                      setDraft({ ...draft, loginAccount: event.target.value })
                    }
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    disabled={!draft.loginAccount}
                    aria-label="复制登录账号"
                    onClick={() => void copyValue("登录账号", draft.loginAccount)}
                  >
                    <Copy />
                  </button>
                </div>
              </label>
              <label>
                登录密码
                <div className="credential-input-row">
                  <input
                    type={passwordVisible ? "text" : "password"}
                    value={draft.loginPassword || ""}
                    onChange={(event) =>
                      setDraft({ ...draft, loginPassword: event.target.value })
                    }
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? <EyeOff /> : <Eye />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={!draft.loginPassword}
                    aria-label="复制登录密码"
                    onClick={() => void copyValue("登录密码", draft.loginPassword)}
                  >
                    <Copy />
                  </button>
                </div>
              </label>
              <label>
                备注
                <textarea
                  rows={3}
                  value={draft.remark || ""}
                  onChange={(event) =>
                    setDraft({ ...draft, remark: event.target.value })
                  }
                  placeholder="短信验证、用途或其他说明"
                />
              </label>
              {hint && <p className="muted-copy" role="status">{hint}</p>}
              <footer className="platform-dialog-actions">
                {draft.id && (
                  <button
                    type="button"
                    className="button danger"
                    onClick={() => void remove()}
                  >
                    <Trash2 />
                    清除资料
                  </button>
                )}
                <span className="spacer" />
                <Dialog.Close className="button secondary">取消</Dialog.Close>
                <button
                  type="button"
                  className="button primary"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  <Save />
                  {saving
                    ? "正在保存"
                    : platform === "5e"
                      ? "保存并查询"
                      : "保存平台资料"}
                </button>
              </footer>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
