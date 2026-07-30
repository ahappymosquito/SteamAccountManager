/** Account detail drawer with independent profile and per-platform credential editing. */
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Check,
  ChevronDown,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Link2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { api } from "../lib/api";
import type {
  Account,
  PlatformLink,
  ProfileInput,
  TagOption,
} from "../lib/types";
import type { QuickPlatformCode } from "./AccountPlatformBadges";
import { AccountAvatar } from "./AccountAvatar";
import { PlayerDataPanel } from "./PlayerDataPanel";

const platformLabels: Record<string, string> = {
  perfectworld: "完美平台",
  "5e": "5E",
  faceit: "FACEIT",
  other: "其他",
};
const quickPlatforms: QuickPlatformCode[] = ["perfectworld", "5e"];

export const profileSchema = z.object({
  alias: z.string().max(80),
  remark: z.string().max(2000),
  favorite: z.boolean(),
});

const uniqueTags = (values: string[]) =>
  values
    .map((value) => value.trim())
    .filter(
      (value, index, all) =>
        value &&
        all.findIndex(
          (item) => item.toLocaleLowerCase() === value.toLocaleLowerCase(),
        ) === index,
    );

const blankLink = (
  account: Account,
  platformCode: string = "perfectworld",
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

const editableLink = (account: Account, link?: PlatformLink, code?: string) =>
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
    : blankLink(account, code);

export function AccountDrawer({
  account,
  tagOptions,
  initialPlatform,
  open,
  onOpenChange,
  onSave,
  notify,
  onChanged,
}: {
  account: Account;
  tagOptions: TagOption[];
  initialPlatform?: QuickPlatformCode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: ProfileInput) => Promise<void>;
  notify: (kind: "success" | "error", text: string) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<string>();
  const [alias, setAlias] = useState(account.alias ?? "");
  const [remark, setRemark] = useState(account.remark ?? "");
  const [favorite, setFavorite] = useState(account.favorite);
  const [tags, setTags] = useState(account.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [links, setLinks] = useState<PlatformLink[]>([]);
  const [linkDraft, setLinkDraft] = useState(blankLink(account));
  const [saving, setSaving] = useState(false);
  const [savingLink, setSavingLink] = useState(false);
  const [matchingPerfectWorld, setMatchingPerfectWorld] = useState(false);
  const [perfectWorldHint, setPerfectWorldHint] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(
    new Set(),
  );

  const loadLinks = async () => {
    const loaded = await api.links(account.id);
    setLinks(loaded);
    return loaded;
  };

  const beginPlatformEdit = (code: string, source = links) => {
    const link = source.find((item) => item.platformCode === code);
    setLinkDraft(editableLink(account, link, code));
    setEditingPlatform(code);
  };

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setEditingPlatform(undefined);
    setAlias(account.alias ?? "");
    setRemark(account.remark ?? "");
    setFavorite(account.favorite);
    setTags(account.tags);
    setTagDraft("");
    setLinkDraft(blankLink(account));
    setPerfectWorldHint("");
    setVisiblePasswords(new Set());
    void (async () => {
      try {
        let loaded = await loadLinks();
        if (initialPlatform) beginPlatformEdit(initialPlatform, loaded);
        const perfectWorld = loaded.find(
          (link) => link.platformCode === "perfectworld",
        );
        if (perfectWorld?.externalId?.trim() === account.steamId64) return;
        const status = await api.platformCredentialStatus("perfectworld");
        if (!status.configured) {
          setPerfectWorldHint(
            "配置完美平台 Access Token 后，将自动使用本账号 SteamID 匹配段位分数。",
          );
          return;
        }
        setMatchingPerfectWorld(true);
        const snapshot = await api.autoLinkPerfectWorld(account.id);
        loaded = await loadLinks();
        if (initialPlatform === "perfectworld") {
          beginPlatformEdit("perfectworld", loaded);
        }
        onChanged();
        setPerfectWorldHint(
          snapshot.capabilities.includes("season_ladder")
            ? "已使用 SteamID 自动匹配完美平台账号。"
            : "已关联 SteamID，但完美平台未返回可确认的赛季记录。",
        );
      } catch (error) {
        setPerfectWorldHint(
          (error as { message?: string }).message ??
            "完美平台自动匹配暂时不可用",
        );
      } finally {
        setMatchingPerfectWorld(false);
      }
    })();
  }, [open, account.id, initialPlatform]);

  const availableTags = useMemo(
    () =>
      tagOptions.filter(
        (option) =>
          !tags.some(
            (tag) =>
              tag.toLocaleLowerCase() === option.name.toLocaleLowerCase(),
          ) &&
          option.name.toLocaleLowerCase().includes(tagDraft.toLocaleLowerCase()),
      ),
    [tagOptions, tags, tagDraft],
  );

  const addTag = (tag: string) => {
    setTags((current) => uniqueTags([...current, tag]));
    setTagDraft("");
  };

  const saveProfile = async () => {
    const parsed = profileSchema.safeParse({ alias, remark, favorite });
    if (!parsed.success) {
      notify("error", "别名或备注内容过长");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        accountId: account.id,
        alias: alias.trim() || undefined,
        remark: remark.trim() || undefined,
        favorite,
        tags: uniqueTags(tags),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const saveLink = async () => {
    setSavingLink(true);
    try {
      const wasEditing = Boolean(linkDraft.id);
      const id = linkDraft.id || crypto.randomUUID();
      const nickname = linkDraft.displayName?.trim();
      const locator =
        linkDraft.platformCode === "5e"
          ? nickname
          : linkDraft.platformCode === "perfectworld"
            ? account.steamId64
            : linkDraft.externalId?.trim();
      const pendingLink = {
        ...linkDraft,
        id,
        externalId: locator || undefined,
        displayName: nickname || undefined,
        profileUrl: linkDraft.profileUrl?.trim() || undefined,
        loginAccount: linkDraft.loginAccount?.trim() || undefined,
        loginPassword: linkDraft.loginPassword || undefined,
        remark: linkDraft.remark?.trim() || undefined,
        status: "unverified" as const,
      };
      await api.saveLink(pendingLink);
      await loadLinks();
      onChanged();
      if (pendingLink.platformCode === "5e" && locator) {
        try {
          await api.playerData(id, true);
          await loadLinks();
          onChanged();
          notify(
            "success",
            wasEditing ? "5E 玩家已验证并更新" : "5E 玩家已验证并关联",
          );
        } catch (error) {
          notify(
            "error",
            `资料已保存，但玩家查询失败：${
              (error as { message?: string }).message ?? "无法查询玩家"
            }`,
          );
          return;
        }
      } else {
        notify("success", wasEditing ? "平台资料已更新" : "平台资料已保存");
      }
      setEditingPlatform(undefined);
      setLinkDraft(blankLink(account));
    } catch (error) {
      notify(
        "error",
        (error as { message?: string }).message ?? "平台资料保存失败",
      );
    } finally {
      setSavingLink(false);
    }
  };

  const removeLink = async (link: PlatformLink) => {
    if (!confirm(`确认清除${platformLabels[link.platformCode]}平台资料？`)) return;
    await api.deleteLink(link.id);
    await loadLinks();
    setEditingPlatform(undefined);
    onChanged();
  };

  const copyValue = async (label: string, value?: string) => {
    if (!value) return;
    try {
      await writeText(value);
      notify("success", `${label}已复制`);
    } catch {
      notify("error", `${label}复制失败`);
    }
  };

  const togglePassword = (id: string) => {
    setVisiblePasswords((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderPlatformEditor = () => (
    <div className="platform-editor">
      <div className="platform-editor-heading">
        <strong>
          编辑{platformLabels[linkDraft.platformCode] || linkDraft.platformCode}
        </strong>
        <button
          type="button"
          className="button secondary"
          onClick={() => setEditingPlatform(undefined)}
        >
          取消修改
        </button>
      </div>
      {!quickPlatforms.includes(linkDraft.platformCode as QuickPlatformCode) && (
        <label>
          平台
          <select
            value={linkDraft.platformCode}
            onChange={(event) =>
              setLinkDraft({
                ...linkDraft,
                platformCode: event.target.value,
              })
            }
          >
            <option value="faceit">FACEIT</option>
            <option value="other">其他</option>
          </select>
        </label>
      )}
      <label>
        平台昵称
        <input
          value={linkDraft.displayName}
          onChange={(event) =>
            setLinkDraft({
              ...linkDraft,
              displayName: event.target.value,
              externalId:
                linkDraft.platformCode === "5e"
                  ? event.target.value
                  : linkDraft.externalId,
            })
          }
          placeholder={
            linkDraft.platformCode === "5e"
              ? "用于查询 5E 玩家数据"
              : "用于识别该平台账号"
          }
        />
      </label>
      <label>
        登录账号
        <div className="credential-input-row">
          <input
            value={linkDraft.loginAccount}
            onChange={(event) =>
              setLinkDraft({
                ...linkDraft,
                loginAccount: event.target.value,
              })
            }
            autoComplete="off"
          />
          <button
            type="button"
            className="icon-button"
            disabled={!linkDraft.loginAccount}
            aria-label="复制登录账号"
            onClick={() =>
              void copyValue("登录账号", linkDraft.loginAccount)
            }
          >
            <Copy />
          </button>
        </div>
      </label>
      <label>
        登录密码
        <div className="credential-input-row">
          <input
            type={visiblePasswords.has("draft") ? "text" : "password"}
            value={linkDraft.loginPassword}
            onChange={(event) =>
              setLinkDraft({
                ...linkDraft,
                loginPassword: event.target.value,
              })
            }
            autoComplete="off"
          />
          <button
            type="button"
            className="icon-button"
            aria-label={visiblePasswords.has("draft") ? "隐藏密码" : "显示密码"}
            onClick={() => togglePassword("draft")}
          >
            {visiblePasswords.has("draft") ? <EyeOff /> : <Eye />}
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={!linkDraft.loginPassword}
            aria-label="复制登录密码"
            onClick={() =>
              void copyValue("登录密码", linkDraft.loginPassword)
            }
          >
            <Copy />
          </button>
        </div>
      </label>
      <label>
        备注
        <textarea
          rows={3}
          value={linkDraft.remark}
          onChange={(event) =>
            setLinkDraft({ ...linkDraft, remark: event.target.value })
          }
          placeholder="短信验证、用途或其他说明"
        />
      </label>
      <button
        className="button primary platform-save"
        disabled={savingLink}
        onClick={() => void saveLink()}
      >
        <Save />
        {savingLink
          ? "正在保存"
          : linkDraft.platformCode === "5e" &&
              linkDraft.displayName?.trim()
            ? "保存并查询"
            : "保存平台资料"}
      </button>
    </div>
  );

  const displayName =
    account.personaName || account.accountName || "未命名账号";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay drawer-overlay" />
        <Dialog.Content className="account-drawer">
          <header className="drawer-header">
            <div className="drawer-identity">
              <AccountAvatar account={account} large />
              <div>
                <Dialog.Title>{displayName}</Dialog.Title>
                <Dialog.Description>
                  {account.alias ? `别名：${account.alias}` : "Steam 账号详情"}
                </Dialog.Description>
              </div>
            </div>
            <div className="drawer-actions">
              {editing ? (
                <button
                  className="button primary"
                  disabled={saving}
                  onClick={() => void saveProfile()}
                >
                  <Save />
                  {saving ? "正在保存" : "保存资料"}
                </button>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => setEditing(true)}
                >
                  <Edit3 />
                  编辑资料
                </button>
              )}
              <Dialog.Close className="icon-button" aria-label="关闭详情">
                <X />
              </Dialog.Close>
            </div>
          </header>
          <div className="drawer-body">
            <section className="detail-section">
              <h3>Steam 信息</h3>
              <dl className="detail-list">
                <div>
                  <dt>Steam 昵称</dt>
                  <dd>{displayName}</dd>
                </div>
                <div>
                  <dt>Steam 登录账号</dt>
                  <dd>{account.accountName || "未提供"}</dd>
                </div>
                <div>
                  <dt>最近切换</dt>
                  <dd>
                    {account.lastSwitchedAt
                      ? new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(account.lastSwitchedAt))
                      : "从未"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="detail-section">
              <h3>本地资料</h3>
              {editing ? (
                <div className="drawer-form">
                  <label>
                    自定义别名
                    <input
                      value={alias}
                      onChange={(event) => setAlias(event.target.value)}
                      placeholder="仅在详情和搜索中使用"
                    />
                  </label>
                  <label>
                    备注
                    <textarea
                      rows={4}
                      value={remark}
                      onChange={(event) => setRemark(event.target.value)}
                      placeholder="用途、库存或其他说明"
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={favorite}
                      onChange={(event) => setFavorite(event.target.checked)}
                    />
                    收藏此账号
                  </label>
                </div>
              ) : (
                <dl className="detail-list">
                  <div>
                    <dt>别名</dt>
                    <dd>{account.alias || "未设置"}</dd>
                  </div>
                  <div>
                    <dt>备注</dt>
                    <dd className="pre-wrap">
                      {account.remark || "暂无备注"}
                    </dd>
                  </div>
                  <div>
                    <dt>收藏</dt>
                    <dd>{account.favorite ? "已收藏" : "未收藏"}</dd>
                  </div>
                </dl>
              )}
            </section>

            <section className="detail-section">
              <h3>标签</h3>
              {editing ? (
                <div className="tag-editor">
                  <div className="tag-chips">
                    {tags.map((tag) => (
                      <button
                        type="button"
                        className="tag-chip"
                        key={tag}
                        onClick={() =>
                          setTags((current) =>
                            current.filter((item) => item !== tag),
                          )
                        }
                      >
                        {tag}
                        <X />
                      </button>
                    ))}
                  </div>
                  <div className="tag-input-row">
                    <input
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && tagDraft.trim()) {
                          event.preventDefault();
                          addTag(tagDraft);
                        }
                      }}
                      placeholder="输入标签，按 Enter 添加"
                      aria-label="添加标签"
                    />
                    <button
                      className="icon-button"
                      disabled={!tagDraft.trim()}
                      onClick={() => addTag(tagDraft)}
                      aria-label="添加当前标签"
                    >
                      <Plus />
                    </button>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger className="button secondary">
                        历史标签
                        <ChevronDown />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="tag-menu"
                          align="end"
                        >
                          {availableTags.length ? (
                            availableTags.map((option) => (
                              <DropdownMenu.Item
                                className="tag-menu-item"
                                key={option.name}
                                onSelect={() => addTag(option.name)}
                              >
                                <span>
                                  <Check />
                                  {option.name}
                                </span>
                                <small>{option.usageCount} 个账号</small>
                              </DropdownMenu.Item>
                            ))
                          ) : (
                            <div className="tag-menu-empty">没有匹配标签</div>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                </div>
              ) : (
                <div className="tags detail-tags">
                  {account.tags.length ? (
                    account.tags.map((tag) => <span key={tag}>{tag}</span>)
                  ) : (
                    <span>未设置标签</span>
                  )}
                </div>
              )}
            </section>

            <section className="detail-section">
              <div className="section-row">
                <h3>平台账号</h3>
                <Link2 />
              </div>
              <div className="fixed-platform-list">
                {quickPlatforms.map((code) => {
                  const link = links.find(
                    (item) => item.platformCode === code,
                  );
                  const passwordVisible =
                    link && visiblePasswords.has(link.id);
                  return (
                    <div className="fixed-platform-block" key={code}>
                      <div
                        className={`platform-account-row${
                          editingPlatform === code ? " editing" : ""
                        }`}
                      >
                        <div className="platform-account-heading">
                          <div>
                            <strong>{platformLabels[code]}</strong>
                            <small>
                              {link
                                ? link.displayName ||
                                  link.externalId ||
                                  "已保存平台资料"
                                : "待填写"}
                            </small>
                          </div>
                          <div className="link-row-actions">
                            <button
                              type="button"
                              className="button secondary platform-edit-action"
                              aria-label={`${
                                link ? "编辑" : "填写"
                              }${platformLabels[code]}资料`}
                              onClick={() => beginPlatformEdit(code)}
                            >
                              <Edit3 />
                              {link ? "编辑" : "填写"}
                            </button>
                            {link && (
                              <button
                                type="button"
                                className="icon-button danger"
                                aria-label={`清除${platformLabels[code]}平台资料`}
                                onClick={() => void removeLink(link)}
                              >
                                <Trash2 />
                              </button>
                            )}
                          </div>
                        </div>
                        {link && (
                          <dl className="platform-credentials">
                            <div>
                              <dt>登录账号</dt>
                              <dd>{link.loginAccount || "未填写"}</dd>
                              <button
                                type="button"
                                className="icon-button"
                                disabled={!link.loginAccount}
                                aria-label={`复制${platformLabels[code]}登录账号`}
                                onClick={() =>
                                  void copyValue(
                                    `${platformLabels[code]}登录账号`,
                                    link.loginAccount,
                                  )
                                }
                              >
                                <Copy />
                              </button>
                            </div>
                            <div>
                              <dt>登录密码</dt>
                              <dd>
                                {link.loginPassword
                                  ? passwordVisible
                                    ? link.loginPassword
                                    : "***"
                                  : "未填写"}
                              </dd>
                              <span className="credential-row-actions">
                                <button
                                  type="button"
                                  className="icon-button"
                                  disabled={!link.loginPassword}
                                  aria-label={
                                    passwordVisible ? "隐藏密码" : "显示密码"
                                  }
                                  onClick={() => togglePassword(link.id)}
                                >
                                  {passwordVisible ? <EyeOff /> : <Eye />}
                                </button>
                                <button
                                  type="button"
                                  className="icon-button"
                                  disabled={!link.loginPassword}
                                  aria-label={`复制${platformLabels[code]}登录密码`}
                                  onClick={() =>
                                    void copyValue(
                                      `${platformLabels[code]}登录密码`,
                                      link.loginPassword,
                                    )
                                  }
                                >
                                  <Copy />
                                </button>
                              </span>
                            </div>
                            <div>
                              <dt>备注</dt>
                              <dd className="pre-wrap">
                                {link.remark || "暂无备注"}
                              </dd>
                            </div>
                          </dl>
                        )}
                      </div>
                      {editingPlatform === code && renderPlatformEditor()}
                    </div>
                  );
                })}
              </div>

              {links.some(
                (link) =>
                  !quickPlatforms.includes(
                    link.platformCode as QuickPlatformCode,
                  ),
              ) && (
                <div className="legacy-platforms">
                  <strong>其他平台</strong>
                  {links
                    .filter(
                      (link) =>
                        !quickPlatforms.includes(
                          link.platformCode as QuickPlatformCode,
                        ),
                    )
                    .map((link) => (
                      <div className="link-row" key={link.id}>
                        <div>
                          <strong>
                            {platformLabels[link.platformCode] ||
                              link.platformCode}
                          </strong>
                          <small>
                            {link.displayName ||
                              link.externalId ||
                              "已关联平台"}
                          </small>
                        </div>
                        <div className="link-row-actions">
                          <button
                            className="icon-button"
                            aria-label={`编辑${platformLabels[link.platformCode]}关联`}
                            onClick={() => {
                              setLinkDraft(editableLink(account, link));
                              setEditingPlatform(link.id);
                            }}
                          >
                            <Edit3 />
                          </button>
                          <button
                            className="icon-button danger"
                            aria-label="删除平台关联"
                            onClick={() => void removeLink(link)}
                          >
                            <Trash2 />
                          </button>
                        </div>
                        {editingPlatform === link.id && renderPlatformEditor()}
                      </div>
                    ))}
                </div>
              )}
              {editing && (
                <button
                  type="button"
                  className="button secondary add-legacy-platform"
                  onClick={() => {
                    setLinkDraft(blankLink(account, "faceit"));
                    setEditingPlatform("legacy-new");
                  }}
                >
                  <Plus />
                  添加其他平台
                </button>
              )}
              {editingPlatform === "legacy-new" && renderPlatformEditor()}
            </section>

            {(matchingPerfectWorld || perfectWorldHint) && (
              <p className="muted-copy" role="status">
                {matchingPerfectWorld
                  ? "正在使用 SteamID 自动匹配完美平台…"
                  : perfectWorldHint}
              </p>
            )}
            {links
              .filter(
                (link) =>
                  quickPlatforms.includes(
                    link.platformCode as QuickPlatformCode,
                  ) && link.externalId?.trim(),
              )
              .map((link) => (
                <PlayerDataPanel
                  key={link.id}
                  link={link}
                  onChanged={onChanged}
                />
              ))}
          </div>
          {editing && (
            <footer className="drawer-footer">
              <button
                className="button secondary"
                onClick={() => {
                  setEditing(false);
                  setAlias(account.alias ?? "");
                  setRemark(account.remark ?? "");
                  setFavorite(account.favorite);
                  setTags(account.tags);
                }}
              >
                取消编辑
              </button>
              <button
                className="button primary"
                disabled={saving}
                onClick={() => void saveProfile()}
              >
                <Save />
                保存资料
              </button>
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
