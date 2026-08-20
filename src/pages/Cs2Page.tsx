/** CS2 CFG workbench: profile files, source editing, and current-command comments. */
import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Copy,
  Download,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { flushCfgDraft, useCfgWorkspace } from "../cfgWorkspace";
import {
  annotateCfgComments,
  defaultCfgTemplate,
  parseCfg,
} from "../lib/cfgDocument";
import { cfgCrosshairCommands } from "../lib/crosshair";
import { api } from "../lib/api";
import type { AppError, CfgProfile } from "../lib/types";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败";

const withTemplateIfEmpty = (profile: CfgProfile): CfgProfile =>
  profile.content.trim()
    ? profile
    : { ...profile, content: defaultCfgTemplate() };

export function Cs2Page({
  notify,
}: {
  notify: (kind: "success" | "error", text: string) => void;
}) {
  const workspace = useCfgWorkspace();
  const [profiles, setProfiles] = useState<CfgProfile[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const gutterRef = useRef<HTMLPreElement>(null);
  const draft = workspace.draft;
  const dirty = workspace.isDirty();
  const document = useMemo(
    () => parseCfg(draft?.content ?? ""),
    [draft?.content],
  );

  const loadProfile = (profile: CfgProfile) => {
    const next = withTemplateIfEmpty(profile);
    workspace.load(next);
    setRenaming(false);
    if (next.content !== profile.content) workspace.edit({ content: next.content });
  };

  const refreshProfiles = async () => {
    await flushCfgDraft();
    const active = await api.activeCfgProfile();
    const items = await api.cfgProfiles();
    setProfiles(items);
    loadProfile(active);
  };

  useEffect(() => {
    void refreshProfiles().catch((error) =>
      notify("error", errorMessage(error)),
    );
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void flushCfgDraft().catch((error) =>
        notify("error", errorMessage(error)),
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [workspace.revision]);

  const lineNumbers = useMemo(
    () =>
      Array.from(
        { length: (draft?.content ?? "").split("\n").length },
        (_, index) => index + 1,
      ).join("\n"),
    [draft?.content],
  );

  const selectProfile = async (id: string) => {
    if (id === draft?.id) return;
    try {
      await flushCfgDraft();
      loadProfile(await api.setActiveCfgProfile(id));
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const createProfile = async () => {
    try {
      await flushCfgDraft();
      const suffix = Date.now().toString().slice(-6);
      const profile = await api.createCfgProfile(
        `新配置 ${profiles.length + 1}`,
        `profile-${suffix}.cfg`,
        defaultCfgTemplate(),
      );
      setProfiles((items) => [...items, profile]);
      workspace.load(profile);
      setRenaming(false);
      notify("success", "已创建并启用 CFG");
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const importFile = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "CS2 CFG", extensions: ["cfg"] }],
      title: "导入 CS2 CFG",
    });
    if (typeof path !== "string") return;
    try {
      await flushCfgDraft();
      const profile = await api.importCfgProfile(path);
      setProfiles((items) => [...items, profile]);
      workspace.load(profile);
      setRenaming(false);
      notify("success", `已导入并启用 ${profile.fileName}`);
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const exportFile = async () => {
    if (!draft) return;
    try {
      await flushCfgDraft();
      const path = await save({
        defaultPath: draft.fileName,
        filters: [{ name: "CS2 CFG", extensions: ["cfg"] }],
        title: "导出 CS2 CFG",
      });
      if (!path) return;
      const exported = await api.exportCfgProfile(draft.id, path);
      notify("success", `已导出到 ${exported}`);
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const refreshComments = () => {
    if (!draft) return;
    const next = annotateCfgComments(draft.content);
    if (next === draft.content) {
      notify("success", "行尾注释已是当前 CS2 指令说明");
      return;
    }
    workspace.edit({ content: next });
    notify("success", "已按当前 CS2 指令库刷新行尾注释，命令值未改");
  };

  const removeProfile = async () => {
    if (!draft || !confirm(`删除“${draft.name}”？至少会保留一个可用方案。`))
      return;
    try {
      await flushCfgDraft();
      await api.deleteCfgProfile(draft.id);
      await refreshProfiles();
      notify("success", "CFG 已删除，当前方案已自动修复");
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const startRename = () => {
    if (!draft) return;
    setRenameValue(draft.name);
    setRenaming(true);
  };

  const commitRename = () => {
    if (!draft) return;
    const name = renameValue.trim();
    if (name && name !== draft.name) {
      workspace.edit({ name });
      setProfiles((items) =>
        items.map((item) => (item.id === draft.id ? { ...item, name } : item)),
      );
    }
    setRenaming(false);
  };

  const copyCrosshair = async () => {
    const value = cfgCrosshairCommands(document);
    if (!value) {
      notify("error", "当前文件没有准星命令");
      return;
    }
    try {
      await writeText(value);
      notify("success", "CFG 准星命令已复制");
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const updateCursor = (textarea: HTMLTextAreaElement) => {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const lines = before.split("\n");
    setCursor({ line: lines.length, column: lines.at(-1)!.length + 1 });
  };

  const editorValue = draft?.content ?? "";
  const saveLabel = workspace.saving
    ? "正在保存"
    : dirty
      ? "等待保存"
      : "已保存";

  return (
    <section className="cs2-workspace">
      <header className="page-heading cfg-heading">
        <div>
          <h1>CS2 CFG 工作台</h1>
          <p>
            直接编辑 CFG 文件，修改会自动保存；不会写入游戏实时文件，也不会启动游戏。
          </p>
        </div>
      </header>

      <div className="cfg-commandbar">
        <div className="cfg-profile-control">
          {renaming ? (
            <input
              autoFocus
              aria-label="方案名称"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <select
              aria-label="当前 CFG"
              value={draft?.id ?? ""}
              onChange={(event) => void selectProfile(event.target.value)}
            >
              {profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name} · {profile.fileName}
                </option>
              ))}
            </select>
          )}
          <button
            className="icon-button"
            aria-label="重命名 CFG"
            disabled={!draft || renaming}
            onClick={startRename}
          >
            <Pencil />
          </button>
          <button
            className="icon-button danger"
            aria-label="删除 CFG"
            disabled={profiles.length <= 1}
            onClick={() => void removeProfile()}
          >
            <Trash2 />
          </button>
        </div>
        <button className="button secondary" onClick={() => void importFile()}>
          <FolderOpen /><span>导入 CFG</span>
        </button>
        <button className="button secondary" onClick={() => void createProfile()}>
          <Plus /><span>新建 CFG</span>
        </button>
        <button className="button secondary" onClick={() => void exportFile()}>
          <Download /><span>导出 CFG</span>
        </button>
        <button
          className="button secondary"
          onClick={refreshComments}
          title="按当前 CS2 指令库更新已识别命令的行尾注释，不改命令值"
        >
          <RefreshCw /><span>刷新注释</span>
        </button>
        <button
          className="button secondary"
          disabled={!cfgCrosshairCommands(document)}
          onClick={() => void copyCrosshair()}
        >
          <Copy /><span>复制准星命令</span>
        </button>
        <code className="exec-preview">+exec {draft?.fileName ?? "autoexec.cfg"}</code>
        <span className={`cfg-save-state ${dirty ? "saving" : "saved"}`}>
          {saveLabel}
        </span>
      </div>

      <section className="code-workbench">
        <div className="editor-surface">
          <pre ref={gutterRef} aria-hidden="true">
            {lineNumbers}
          </pre>
          <textarea
            aria-label="CFG 编辑器"
            value={editorValue}
            spellCheck={false}
            onChange={(event) => {
              workspace.edit({ content: event.target.value });
              updateCursor(event.currentTarget);
            }}
            onClick={(event) => updateCursor(event.currentTarget)}
            onKeyUp={(event) => updateCursor(event.currentTarget)}
            onSelect={(event) => updateCursor(event.currentTarget)}
            onScroll={(event) => {
              if (gutterRef.current)
                gutterRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
          />
        </div>
        <footer className="editor-statusbar">
          <span>{saveLabel}</span>
          <span className="spacer" />
          <span>Ln {cursor.line}, Col {cursor.column}</span>
          <span>UTF-8</span><span>CFG</span>
        </footer>
      </section>
    </section>
  );
}
