/** Focused CS2 CFG workspace with global activation, autosave, and read-only runtime previews. */
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Clock3,
  FileCode2,
  FolderOpen,
  History,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { flushCfgDraft, useCfgWorkspace } from "../cfgWorkspace";
import { api } from "../lib/api";
import type {
  AppError,
  CfgProfile,
  CfgProfileVersion,
  Cs2RuntimeFile,
} from "../lib/types";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败";

const commandNotes: Record<string, { description: string; source: string }> = {
  bind: {
    description: "将按键绑定到命令，包含空格的命令应使用引号。",
    source: "https://developer.valvesoftware.com/wiki/Bind",
  },
  unbind: {
    description: "移除指定按键的绑定。",
    source: "https://developer.valvesoftware.com/wiki/Bind",
  },
  alias: {
    description: "为一组控制台命令定义简短名称。",
    source: "https://developer.valvesoftware.com/wiki/Alias",
  },
  exec: {
    description: "执行另一个 CFG 文件。",
    source: "https://developer.valvesoftware.com/wiki/Exec",
  },
  fps_max: {
    description: "限制客户端最大帧率，0 通常表示不限制。",
    source:
      "https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables",
  },
  sensitivity: {
    description: "设置鼠标灵敏度倍率。",
    source:
      "https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables",
  },
  volume: {
    description: "设置游戏主音量。",
    source:
      "https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables",
  },
};

type Preview = { path: string; name: string; content: string };
type ToolTab = "notes" | "history" | "runtime";

export function Cs2Page({
  notify,
}: {
  notify: (kind: "success" | "error", text: string) => void;
}) {
  const workspace = useCfgWorkspace();
  const [profiles, setProfiles] = useState<CfgProfile[]>([]);
  const [versions, setVersions] = useState<CfgProfileVersion[]>([]);
  const [runtimeFiles, setRuntimeFiles] = useState<Cs2RuntimeFile[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [toolTab, setToolTab] = useState<ToolTab>("notes");
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const gutterRef = useRef<HTMLPreElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const draft = workspace.draft;
  const dirty = workspace.isDirty();

  const refreshProfiles = async () => {
    await flushCfgDraft();
    const active = await api.activeCfgProfile();
    const items = await api.cfgProfiles();
    setProfiles(items);
    workspace.load(active);
    setPreview(undefined);
    setVersions(await api.cfgVersions(active.id).catch(() => []));
  };

  useEffect(() => {
    void Promise.all([
      refreshProfiles(),
      api.cs2RuntimeFiles().then(setRuntimeFiles).catch(() => setRuntimeFiles([])),
    ]).catch((error) => notify("error", errorMessage(error)));
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void flushCfgDraft()
        .then(() => {
          const saved = useCfgWorkspace.getState().draft;
          if (saved) {
            setProfiles((items) =>
              items.map((item) =>
                item.id === saved.id
                  ? {
                      ...item,
                      name: saved.name,
                      content: saved.content,
                      updatedAt: new Date().toISOString(),
                    }
                  : item,
              ),
            );
          }
        })
        .catch((error) => notify("error", errorMessage(error)));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [workspace.revision]);

  const notes = useMemo(() => {
    const seen = new Set<string>();
    return (draft?.content ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"))
      .map((line) => line.split(/\s+/)[0].toLowerCase())
      .filter((command) => !seen.has(command) && Boolean(seen.add(command)))
      .map((command) => ({ command, note: commandNotes[command] }));
  }, [draft?.content]);

  const lineNumbers = useMemo(
    () =>
      Array.from(
        { length: (preview?.content ?? draft?.content ?? "").split("\n").length },
        (_, index) => index + 1,
      ).join("\n"),
    [draft?.content, preview?.content],
  );

  const selectProfile = async (id: string) => {
    if (id === draft?.id) return;
    try {
      await flushCfgDraft();
      const selected = await api.setActiveCfgProfile(id);
      workspace.load(selected);
      setPreview(undefined);
      setVersions(await api.cfgVersions(id).catch(() => []));
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
      );
      setProfiles((items) => [...items, profile]);
      workspace.load(profile);
      setPreview(undefined);
      setVersions([]);
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
      setPreview(undefined);
      setVersions([]);
      notify("success", `已导入并启用 ${profile.fileName}`);
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const removeProfile = async () => {
    if (
      !draft ||
      !confirm(`删除“${draft.name}”？至少会保留一个可用方案。`)
    )
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

  const restore = async (version: CfgProfileVersion) => {
    if (!draft || !confirm("恢复该历史内容？当前内容会先进入历史。")) return;
    try {
      workspace.edit({
        content: await api.restoreCfgVersion(draft.id, version.id),
      });
      notify("success", "历史内容已载入，正在保存");
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const showPreview = async (file: Cs2RuntimeFile) => {
    try {
      setPreview({
        path: file.path,
        name: file.name,
        content: await api.previewCs2RuntimeFile(file.path),
      });
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const updateCursor = (target: HTMLTextAreaElement) => {
    const before = target.value.slice(0, target.selectionStart);
    const lines = before.split("\n");
    setCursor({ line: lines.length, column: lines.at(-1)!.length + 1 });
  };

  const onEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void flushCfgDraft().catch((error) => notify("error", errorMessage(error)));
      return;
    }
    if (event.key === "Tab" && !preview) {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = `${target.value.slice(0, start)}  ${target.value.slice(end)}`;
      workspace.edit({ content: next });
      window.requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
        updateCursor(target);
      });
    }
  };

  const editorValue = preview?.content ?? draft?.content ?? "";
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
          <p>当前方案会在切换任何 Steam 账号前复制、校验并更新启动项。</p>
        </div>
      </header>

      <div className="cfg-commandbar">
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
        <button className="button secondary" onClick={() => void importFile()}>
          <FolderOpen />
          导入 CFG
        </button>
        <button className="button secondary" onClick={() => void createProfile()}>
          <Plus />
          新建 CFG
        </button>
        <code className="exec-preview">+exec {draft?.fileName ?? "autoexec.cfg"}</code>
        <span className={`cfg-save-state ${dirty ? "saving" : "saved"}`}>
          {saveLabel}
        </span>
      </div>

      <section className="code-workbench">
        <div className="editor-tabbar">
          <div className="editor-tab active">
            <FileCode2 />
            {preview ? preview.name : draft?.fileName}
            {preview && <span>只读</span>}
          </div>
          {preview && (
            <button onClick={() => setPreview(undefined)}>返回当前 CFG</button>
          )}
          {!preview && draft && (
            <>
              <input
                aria-label="方案名称"
                value={draft.name}
                onChange={(event) => workspace.edit({ name: event.target.value })}
              />
              <button
                className="icon-button danger"
                aria-label="删除 CFG"
                disabled={profiles.length <= 1}
                onClick={() => void removeProfile()}
              >
                <Trash2 />
              </button>
            </>
          )}
        </div>
        <div className="editor-surface">
          <pre ref={gutterRef} aria-hidden="true">
            {lineNumbers}
          </pre>
          <textarea
            ref={editorRef}
            aria-label={preview ? "运行文件只读预览" : "CFG 编辑器"}
            value={editorValue}
            readOnly={Boolean(preview)}
            spellCheck={false}
            onChange={(event) => workspace.edit({ content: event.target.value })}
            onKeyDown={onEditorKeyDown}
            onClick={(event) => updateCursor(event.currentTarget)}
            onKeyUp={(event) => updateCursor(event.currentTarget)}
            onScroll={(event) => {
              if (gutterRef.current) {
                gutterRef.current.scrollTop = event.currentTarget.scrollTop;
              }
            }}
          />
        </div>
        <footer className="editor-statusbar">
          <span>{preview ? "只读预览" : saveLabel}</span>
          <span className="spacer" />
          <span>
            Ln {cursor.line}, Col {cursor.column}
          </span>
          <span>UTF-8</span>
          <span>CFG</span>
        </footer>
      </section>

      <details className="cfg-tools">
        <summary>备注、历史与运行文件</summary>
        <div className="cfg-tool-tabs">
          <button
            className={toolTab === "notes" ? "active" : ""}
            onClick={() => setToolTab("notes")}
          >
            <FileCode2 />
            命令备注
          </button>
          <button
            className={toolTab === "history" ? "active" : ""}
            onClick={() => setToolTab("history")}
          >
            <History />
            历史版本
          </button>
          <button
            className={toolTab === "runtime" ? "active" : ""}
            onClick={() => setToolTab("runtime")}
          >
            <FolderOpen />
            运行文件
          </button>
        </div>
        <div className="cfg-tool-content">
          {toolTab === "notes" &&
            (notes.length ? (
              notes.map(({ command, note }) => (
                <article className="command-note" key={command}>
                  <code>{command}</code>
                  <p>{note?.description || "暂无匹配的官方说明。"}</p>
                  {note && (
                    <button onClick={() => void openUrl(note.source)}>
                      查看官方说明
                    </button>
                  )}
                </article>
              ))
            ) : (
              <p className="muted-copy">输入命令后显示匹配备注，备注不会写入 CFG。</p>
            ))}
          {toolTab === "history" &&
            (versions.length ? (
              versions.map((version) => (
                <button
                  className="history-row"
                  key={version.id}
                  onClick={() => void restore(version)}
                >
                  <Clock3 />
                  {new Date(version.createdAt).toLocaleString("zh-CN")}
                  <RotateCcw />
                </button>
              ))
            ) : (
              <p className="muted-copy">修改后自动保留最近 10 个版本。</p>
            ))}
          {toolTab === "runtime" &&
            (runtimeFiles.length ? (
              <div className="runtime-file-list">
                {runtimeFiles.map((file) => (
                  <button key={file.path} onClick={() => void showPreview(file)}>
                    <span>账号 …{file.steamId64.slice(-6)}</span>
                    <strong>{file.name}</strong>
                    <small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted-copy">未检测到 CS2 运行配置文件。</p>
            ))}
        </div>
      </details>
    </section>
  );
}
