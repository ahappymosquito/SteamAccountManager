/** Steam account detail drawer with editable local profile and read-only platform cards. */
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Check,
  ChevronDown,
  ChevronRight,
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
import type { Account, PlatformLink, ProfileInput, TagOption } from "../lib/types";
import { AccountAvatar } from "./AccountAvatar";
import { PlayerDataPanel } from "./PlayerDataPanel";

const platformLabels: Record<string, string> = {
  perfectworld: "完美",
  "5e": "5E",
  faceit: "FACEIT",
  other: "其他平台",
};

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

const platformSummary = (account: Account, link: PlatformLink) => {
  const rank = account.playerRanks?.find(
    (item) => item.platform === link.platformCode,
  );
  if (link.platformCode === "5e") {
    if (rank?.rankingState === "placement") {
      return `未定级${
        rank.placementMatches === undefined
          ? ""
          : ` · 已打 ${rank.placementMatches} 场`
      }`;
    }
    if (rank?.rankingState === "ranked" && rank.score !== undefined) {
      return [rank.rankName, `${Math.round(rank.score)} 分`]
        .filter(Boolean)
        .join(" · ");
    }
  }
  return rank?.rankName || "";
};

export function AccountDrawer({
  account,
  tagOptions,
  open,
  onOpenChange,
  onSave,
  notify,
  onChanged,
  onDelete,
}: {
  account: Account;
  tagOptions: TagOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: ProfileInput) => Promise<void>;
  notify: (kind: "success" | "error", text: string) => void;
  onChanged: () => void;
  onDelete?: (account: Account) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState(account.alias ?? "");
  const [remark, setRemark] = useState(account.remark ?? "");
  const [favorite, setFavorite] = useState(account.favorite);
  const [tags, setTags] = useState(account.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [links, setLinks] = useState<PlatformLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [expandedLinkId, setExpandedLinkId] = useState<string>();
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(
    new Set(),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setEditing(false);
    setAlias(account.alias ?? "");
    setRemark(account.remark ?? "");
    setFavorite(account.favorite);
    setTags(account.tags);
    setTagDraft("");
    setExpandedLinkId(undefined);
    setVisiblePasswords(new Set());
    setLinksLoading(true);
    void api
      .links(account.id)
      .then((loaded) => active && setLinks(loaded))
      .catch((error) => {
        if (active) {
          notify(
            "error",
            (error as { message?: string }).message || "平台资料加载失败",
          );
        }
      })
      .finally(() => active && setLinksLoading(false));
    return () => {
      active = false;
    };
  }, [open, account.id]);

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

  const displayName = account.personaName || "未命名 Steam 账号";

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
              {onDelete ? (
                <button
                  className="button danger"
                  onClick={() => onDelete(account)}
                >
                  <Trash2 />
                  删除账号
                </button>
              ) : null}
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
                  <div><dt>别名</dt><dd>{account.alias || "未设置"}</dd></div>
                  <div>
                    <dt>备注</dt>
                    <dd className="pre-wrap">{account.remark || "暂无备注"}</dd>
                  </div>
                  <div><dt>收藏</dt><dd>{account.favorite ? "已收藏" : "未收藏"}</dd></div>
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
                        {tag}<X />
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
                        历史标签<ChevronDown />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="tag-menu" align="end">
                          {availableTags.length ? (
                            availableTags.map((option) => (
                              <DropdownMenu.Item
                                className="tag-menu-item"
                                key={option.name}
                                onSelect={() => addTag(option.name)}
                              >
                                <span><Check />{option.name}</span>
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
                <h3>平台账号与战绩</h3>
                <Link2 />
              </div>
              <p className="muted-copy">
                平台资料请从账号列表的“完美”或“5E”卡片编辑。
              </p>
              {linksLoading ? (
                <p className="muted-copy" aria-busy="true">正在加载平台资料…</p>
              ) : links.length ? (
                <div className="platform-detail-cards">
                  {links.map((link) => {
                    const expanded = expandedLinkId === link.id;
                    const passwordVisible = visiblePasswords.has(link.id);
                    const supportsStats =
                      link.platformCode === "perfectworld" ||
                      link.platformCode === "5e";
                    return (
                      <article
                        className={`platform-detail-card${expanded ? " expanded" : ""}`}
                        key={link.id}
                      >
                        <button
                          type="button"
                          className="platform-card-toggle"
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedLinkId(expanded ? undefined : link.id)
                          }
                        >
                          {expanded ? <ChevronDown /> : <ChevronRight />}
                          <span>
                            <strong>
                              {platformLabels[link.platformCode] || link.platformCode}
                            </strong>
                            <small>
                              {link.displayName || link.externalId || "已关联平台"}
                            </small>
                          </span>
                          <em>{platformSummary(account, link)}</em>
                        </button>
                        {expanded && (
                          <div className="platform-card-content">
                            <dl className="platform-credentials">
                              <div>
                                <dt>登录账号</dt>
                                <dd>{link.loginAccount || "未填写"}</dd>
                                <button
                                  type="button"
                                  className="icon-button"
                                  disabled={!link.loginAccount}
                                  aria-label={`复制${platformLabels[link.platformCode]}登录账号`}
                                  onClick={() =>
                                    void copyValue("登录账号", link.loginAccount)
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
                                    aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                                    onClick={() => togglePassword(link.id)}
                                  >
                                    {passwordVisible ? <EyeOff /> : <Eye />}
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-button"
                                    disabled={!link.loginPassword}
                                    aria-label={`复制${platformLabels[link.platformCode]}登录密码`}
                                    onClick={() =>
                                      void copyValue("登录密码", link.loginPassword)
                                    }
                                  >
                                    <Copy />
                                  </button>
                                </span>
                              </div>
                              <div>
                                <dt>备注</dt>
                                <dd className="pre-wrap">{link.remark || "暂无备注"}</dd>
                              </div>
                            </dl>
                            {supportsStats && link.externalId?.trim() && (
                              <PlayerDataPanel link={link} onChanged={onChanged} />
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="muted-copy">尚未填写平台账号。</p>
              )}
            </section>
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
                <Save />保存资料
              </button>
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
