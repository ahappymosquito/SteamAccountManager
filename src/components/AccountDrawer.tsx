/** Unified account details and editing drawer for profile, tags and platform associations. */
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Edit3, Link2, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { api } from "../lib/api";
import type { Account, PlatformLink, ProfileInput, TagOption } from "../lib/types";
import { AccountAvatar } from "./AccountAvatar";
import { PlayerDataPanel } from "./PlayerDataPanel";

const platformLabels: Record<string, string> = { perfectworld: "完美世界", "5e": "5E", faceit: "FACEIT", other: "其他" };
export const profileSchema = z.object({ alias: z.string().max(80), remark: z.string().max(2000), favorite: z.boolean() });
const uniqueTags = (values: string[]) => values.map((value) => value.trim()).filter((value, index, all) => value && all.findIndex((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase()) === index);
const blankLink = (account: Account): Omit<PlatformLink, "lastVerifiedAt"> => ({ id: "", steamAccountId: account.id, platformCode: "perfectworld", externalId: "", displayName: "", profileUrl: "", remark: "", status: "unverified" });

export function AccountDrawer({ account, tagOptions, open, onOpenChange, onSave, notify, onChanged }: { account: Account; tagOptions: TagOption[]; open: boolean; onOpenChange: (open: boolean) => void; onSave: (input: ProfileInput) => Promise<void>; notify: (kind: "success" | "error", text: string) => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
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
  const loadLinks = async () => {
    const loaded = await api.links(account.id);
    setLinks(loaded);
    return loaded;
  };
  useEffect(() => {
    if (!open) return;
    setEditing(false); setAlias(account.alias ?? ""); setRemark(account.remark ?? ""); setFavorite(account.favorite); setTags(account.tags); setTagDraft(""); setLinkDraft(blankLink(account)); setPerfectWorldHint("");
    void (async () => {
      try {
        const loaded = await loadLinks();
        const perfectWorld = loaded.find((link) => link.platformCode === "perfectworld");
        if (perfectWorld?.externalId?.trim() === account.steamId64) return;
        const status = await api.platformCredentialStatus("perfectworld");
        if (!status.configured) {
          setPerfectWorldHint("配置完美平台 Access Token 后，将自动使用本账号 SteamID 匹配段位分数。");
          return;
        }
        setMatchingPerfectWorld(true);
        const snapshot = await api.autoLinkPerfectWorld(account.id);
        await loadLinks();
        onChanged();
        setPerfectWorldHint(snapshot.capabilities.includes("season_ladder")
          ? "已使用 SteamID 自动匹配完美平台账号。"
          : "已关联 SteamID，但完美平台未返回可确认的赛季记录。");
      } catch (error) {
        setPerfectWorldHint((error as { message?: string }).message ?? "完美平台自动匹配暂时不可用");
      } finally {
        setMatchingPerfectWorld(false);
      }
    })();
  }, [open, account.id]);
  const availableTags = useMemo(() => tagOptions.filter((option) => !tags.some((tag) => tag.toLocaleLowerCase() === option.name.toLocaleLowerCase()) && option.name.toLocaleLowerCase().includes(tagDraft.toLocaleLowerCase())), [tagOptions, tags, tagDraft]);
  const addTag = (tag: string) => { setTags((current) => uniqueTags([...current, tag])); setTagDraft(""); };
  const saveProfile = async () => {
    const parsed = profileSchema.safeParse({ alias, remark, favorite });
    if (!parsed.success) { notify("error", "别名或备注内容过长"); return; }
    setSaving(true);
    try { await onSave({ accountId: account.id, alias: alias.trim() || undefined, remark: remark.trim() || undefined, favorite, tags: uniqueTags(tags) }); setEditing(false); setLinkDraft(blankLink(account)); }
    finally { setSaving(false); }
  };
  const saveLink = async () => {
    setSavingLink(true);
    try {
      const wasEditing = Boolean(linkDraft.id);
      const id = linkDraft.id || crypto.randomUUID();
      const locator = linkDraft.externalId?.trim();
      const profileUrl = linkDraft.profileUrl?.trim()
        || (linkDraft.platformCode === "5e" && /^https?:\/\//i.test(locator || "") ? locator : undefined);
      const pendingLink = {
        ...linkDraft,
        id,
        externalId: locator || undefined,
        displayName: linkDraft.displayName?.trim() || undefined,
        profileUrl,
        remark: linkDraft.remark?.trim() || undefined,
        status: "unverified" as const,
      };
      await api.saveLink(pendingLink);
      setLinkDraft({
        ...pendingLink,
        externalId: pendingLink.externalId || "",
        displayName: pendingLink.displayName || "",
        profileUrl: pendingLink.profileUrl || "",
        remark: pendingLink.remark || "",
      });
      await loadLinks();
      onChanged();
      if (pendingLink.platformCode === "5e" && locator) {
        try {
          const snapshot = await api.playerData(id, true);
          await loadLinks();
          onChanged();
          notify("success", wasEditing ? "5E 玩家已验证并更新" : "5E 玩家已验证并关联");
        } catch (error) {
          notify("error", `关联已保存，但验证失败：${(error as { message?: string }).message ?? "无法查询玩家"}`);
          return;
        }
      } else {
        notify("success", wasEditing ? "平台关联已更新" : "平台关联已保存");
      }
      setLinkDraft(blankLink(account));
    }
    catch (error) { notify("error", (error as { message?: string }).message ?? "平台关联保存失败"); }
    finally { setSavingLink(false); }
  };
  const editLink = (link: PlatformLink) => setLinkDraft({
    id: link.id,
    steamAccountId: link.steamAccountId,
    platformCode: link.platformCode,
    externalId: link.externalId || "",
    displayName: link.displayName || "",
    profileUrl: link.profileUrl || "",
    remark: link.remark || "",
    status: link.status,
  });
  const removeLink = async (id: string) => { if (!confirm("确认删除这条平台关联？")) return; await api.deleteLink(id); await loadLinks(); onChanged(); };
  const displayName = account.personaName || account.accountName || "未命名账号";
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="overlay drawer-overlay"/><Dialog.Content className="account-drawer"><header className="drawer-header"><div className="drawer-identity"><AccountAvatar account={account} large/><div><Dialog.Title>{displayName}</Dialog.Title><Dialog.Description>{account.alias ? `别名：${account.alias}` : "Steam 账号详情"}</Dialog.Description></div></div><div className="drawer-actions">{editing ? <button className="button primary" disabled={saving} onClick={() => void saveProfile()}><Save/>{saving ? "正在保存" : "保存资料"}</button> : <button className="button secondary" onClick={() => setEditing(true)}><Edit3/>编辑资料</button>}<Dialog.Close className="icon-button" aria-label="关闭详情"><X/></Dialog.Close></div></header><div className="drawer-body">
    <section className="detail-section"><h3>Steam 信息</h3><dl className="detail-list"><div><dt>Steam 昵称</dt><dd>{displayName}</dd></div><div><dt>Steam 登录账号</dt><dd>{account.accountName || "未提供"}</dd></div><div><dt>最近切换</dt><dd>{account.lastSwitchedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(account.lastSwitchedAt)) : "从未"}</dd></div></dl></section>
    <section className="detail-section"><h3>本地资料</h3>{editing ? <div className="drawer-form"><label>自定义别名<input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="仅在详情和搜索中使用"/></label><label>备注<textarea rows={4} value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="用途、库存或其他说明"/></label><label className="check"><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)}/>收藏此账号</label></div> : <dl className="detail-list"><div><dt>别名</dt><dd>{account.alias || "未设置"}</dd></div><div><dt>备注</dt><dd className="pre-wrap">{account.remark || "暂无备注"}</dd></div><div><dt>收藏</dt><dd>{account.favorite ? "已收藏" : "未收藏"}</dd></div></dl>}</section>
    <section className="detail-section"><h3>标签</h3>{editing ? <div className="tag-editor"><div className="tag-chips">{tags.map((tag) => <button type="button" className="tag-chip" key={tag} onClick={() => setTags((current) => current.filter((item) => item !== tag))}>{tag}<X/></button>)}</div><div className="tag-input-row"><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && tagDraft.trim()) { event.preventDefault(); addTag(tagDraft); } }} placeholder="输入标签，按 Enter 添加" aria-label="添加标签"/><button className="icon-button" disabled={!tagDraft.trim()} onClick={() => addTag(tagDraft)} aria-label="添加当前标签"><Plus/></button><DropdownMenu.Root><DropdownMenu.Trigger className="button secondary">历史标签<ChevronDown/></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="tag-menu" align="end">{availableTags.length ? availableTags.map((option) => <DropdownMenu.Item className="tag-menu-item" key={option.name} onSelect={() => addTag(option.name)}><span><Check/>{option.name}</span><small>{option.usageCount} 个账号</small></DropdownMenu.Item>) : <div className="tag-menu-empty">没有匹配标签</div>}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div></div> : <div className="tags detail-tags">{account.tags.length ? account.tags.map((tag) => <span key={tag}>{tag}</span>) : <span>未设置标签</span>}</div>}</section>
    <section className="detail-section"><div className="section-row"><h3>平台关联</h3><Link2/></div><div className="link-list">{links.length ? links.map((link) => <div className={`link-row${linkDraft.id === link.id ? " editing" : ""}`} key={link.id}><div><strong>{platformLabels[link.platformCode] || link.platformCode}</strong><small>{link.displayName || link.externalId || (link.platformCode === "5e" ? "仅平台关联，补充玩家信息后可查询战绩" : "仅平台关联")}</small></div>{editing && <div className="link-row-actions"><button className="icon-button" aria-label={`编辑 ${platformLabels[link.platformCode] || link.platformCode} 关联`} onClick={() => editLink(link)}><Edit3/></button><button className="icon-button danger" aria-label="删除平台关联" onClick={() => void removeLink(link.id)}><Trash2/></button></div>}</div>) : <p className="muted-copy">尚未关联第三方平台。</p>}</div>{editing && <div className="platform-editor"><div className="platform-editor-heading"><strong>{linkDraft.id ? "编辑平台关联" : "添加平台关联"}</strong>{linkDraft.id && <button type="button" className="button secondary" onClick={() => setLinkDraft(blankLink(account))}>取消修改</button>}</div><label>平台<select value={linkDraft.platformCode} onChange={(event) => setLinkDraft({ ...linkDraft, platformCode: event.target.value })}><option value="perfectworld">完美世界</option><option value="5e">5E</option><option value="faceit">FACEIT</option><option value="other">其他</option></select></label><label>{linkDraft.platformCode === "5e" ? "5E 玩家名称、主页链接或 ID（查询战绩可选）" : "平台账号（可选）"}<input value={linkDraft.externalId} onChange={(event) => setLinkDraft({ ...linkDraft, externalId: event.target.value })} placeholder={linkDraft.platformCode === "5e" ? "例如：玩家名称、1111 或完整主页链接" : "不填写时仅关联平台"}/></label><label>平台昵称（可选）<input value={linkDraft.displayName} onChange={(event) => setLinkDraft({ ...linkDraft, displayName: event.target.value })}/></label><label>个人主页（可选）<input value={linkDraft.profileUrl} onChange={(event) => setLinkDraft({ ...linkDraft, profileUrl: event.target.value })}/></label><label>备注（可选）<textarea rows={2} value={linkDraft.remark} onChange={(event) => setLinkDraft({ ...linkDraft, remark: event.target.value })}/></label><button className="button secondary" disabled={savingLink} onClick={() => void saveLink()}>{linkDraft.id ? <Save/> : <Plus/>}{savingLink ? "正在保存" : linkDraft.platformCode === "5e" && linkDraft.externalId?.trim() ? linkDraft.id ? "验证并保存修改" : "保存并验证" : linkDraft.id ? "保存修改" : "添加关联"}</button></div>}</section>
    {!editing && (matchingPerfectWorld || perfectWorldHint) && <p className="muted-copy" role="status">{matchingPerfectWorld ? "正在使用 SteamID 自动匹配完美平台…" : perfectWorldHint}</p>}
    {!editing && links.filter((link) => ["5e", "perfectworld"].includes(link.platformCode) && link.externalId?.trim()).map((link) => <PlayerDataPanel key={link.id} link={link} onChanged={onChanged}/>)}
  </div>{editing && <footer className="drawer-footer"><button className="button secondary" onClick={() => { setEditing(false); setAlias(account.alias ?? ""); setRemark(account.remark ?? ""); setFavorite(account.favorite); setTags(account.tags); setLinkDraft(blankLink(account)); }}>取消编辑</button><button className="button primary" disabled={saving} onClick={() => void saveProfile()}><Save/>保存资料</button></footer>}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
