/** CS2 CFG workbench with lossless visual editing, source editing, export, and history. */
import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Clock3,
  Code2,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  History,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  CrosshairPreview,
  type CrosshairBackground,
} from "../components/CrosshairPreview";
import { flushCfgDraft, useCfgWorkspace } from "../cfgWorkspace";
import {
  appendCommand,
  commandDefinitions,
  commandLinesForSection,
  commandValue,
  definitionFor,
  duplicateCount,
  effectiveCommand,
  parseCfg,
  removeCommandNode,
  removeScalarCommand,
  sectionLabels,
  sectionOrder,
  setScalarCommand,
  updateCommandNode,
  type CfgCommandNode,
  type CfgSectionId,
  type CommandDefinition,
} from "../lib/cfgDocument";
import {
  cfgCrosshairCommands,
  officialCrosshairShareCode,
  readCrosshair,
} from "../lib/crosshair";
import { api } from "../lib/api";
import type {
  AppError,
  CfgProfile,
  CfgProfileVersion,
  Cs2RuntimeFile,
} from "../lib/types";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败";

type Preview = { path: string; name: string; content: string };
type ToolTab = "history" | "runtime";
type WorkspaceView = "visual" | "source";

const quoted = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const newCommandForSection = (section: CfgSectionId) => {
  const examples: Record<CfgSectionId, [string, string[]]> = {
    crosshair: ["cl_crosshairsize", ["2"]],
    audio: ["volume", ["0.5"]],
    binds: ["bind", ["key", "command"]],
    input: ["sensitivity", ["1"]],
    hud: ["hud_scaling", ["0.85"]],
    performance: ["fps_max", ["300"]],
    scripts: ["alias", ["new_alias", "echo ready"]],
    practice: ["sv_cheats", ["1"]],
    other: ["custom_command", ["value"]],
  };
  return examples[section];
};

function ScalarSettingRow({
  definition,
  document,
  onChange,
  onRemove,
}: {
  definition: CommandDefinition;
  document: ReturnType<typeof parseCfg>;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const node = effectiveCommand(document, definition.command);
  const value = commandValue(node) ?? "";
  const numeric = definition.control === "number";
  const numberValue = Number(value);
  const invalid =
    Boolean(node) &&
    (numeric
      ? !Number.isFinite(numberValue) ||
        (definition.min !== undefined && numberValue < definition.min) ||
        (definition.max !== undefined && numberValue > definition.max)
      : definition.control === "boolean" && value !== "0" && value !== "1");
  const overridden = duplicateCount(document, definition.command);

  return (
    <div className="cfg-setting-row">
      <div className="cfg-setting-copy">
        <label htmlFor={`cfg-${definition.command}`}>{definition.label}</label>
        <p>{definition.description}</p>
        <code>{definition.command}</code>
        {overridden > 0 && (
          <span className="cfg-warning">前面有 {overridden} 项已被覆盖</span>
        )}
        {invalid && (
          <span className="cfg-error">值无效，已保留原文；预览使用安全回退值</span>
        )}
      </div>
      <div className="cfg-setting-control">
        {definition.control === "select" ||
        definition.control === "boolean" ? (
          <select
            id={`cfg-${definition.command}`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            {!node && <option value="">未设置</option>}
            {invalid && <option value={value}>原值：{value}</option>}
            {definition.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="cfg-number-control">
            <input
              id={`cfg-${definition.command}`}
              type="number"
              value={value}
              min={definition.min}
              max={definition.max}
              step={definition.step}
              placeholder="未设置"
              onChange={(event) => onChange(event.target.value)}
            />
            {definition.min !== undefined &&
              definition.max !== undefined &&
              node &&
              !invalid && (
                <input
                  aria-label={`${definition.label}滑块`}
                  type="range"
                  value={numberValue}
                  min={definition.min}
                  max={definition.max}
                  step={definition.step}
                  onChange={(event) => onChange(event.target.value)}
                />
              )}
          </div>
        )}
        <button
          className="cfg-remove"
          disabled={!node}
          onClick={onRemove}
          title="删除此命令的全部覆盖项"
        >
          从 CFG 移除
        </button>
      </div>
    </div>
  );
}

function CommandRow({
  node,
  conflict,
  onEdit,
  onRemove,
}: {
  node: CfgCommandNode;
  conflict?: boolean;
  onEdit: (command: string, argumentText: string) => void;
  onRemove: () => void;
}) {
  const bind = node.normalizedCommand === "bind";
  return (
    <div className="cfg-command-row">
      {bind ? (
        <>
          <input
            aria-label="绑定按键"
            value={node.args[0] ?? ""}
            onChange={(event) =>
              onEdit("bind", `${quoted(event.target.value)} ${quoted(node.args[1] ?? "")}`)
            }
          />
          <input
            aria-label="绑定命令"
            value={node.args[1] ?? ""}
            onChange={(event) =>
              onEdit("bind", `${quoted(node.args[0] ?? "")} ${quoted(event.target.value)}`)
            }
          />
        </>
      ) : (
        <>
          <input
            aria-label="命令名"
            value={node.command}
            onChange={(event) => onEdit(event.target.value, node.argumentText)}
          />
          <input
            aria-label="命令参数"
            value={node.argumentText}
            onChange={(event) => onEdit(node.command, event.target.value)}
          />
        </>
      )}
      {conflict && <span className="cfg-error">该按键存在重复绑定</span>}
      <button className="icon-button danger" aria-label="删除命令" onClick={onRemove}>
        <Trash2 />
      </button>
    </div>
  );
}

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
  const [toolTab, setToolTab] = useState<ToolTab>("history");
  const [view, setView] = useState<WorkspaceView>("visual");
  const [section, setSection] = useState<CfgSectionId>("crosshair");
  const [background, setBackground] = useState<CrosshairBackground>("dark");
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const gutterRef = useRef<HTMLPreElement>(null);
  const draft = workspace.draft;
  const dirty = workspace.isDirty();
  const document = useMemo(
    () => parseCfg(draft?.content ?? ""),
    [draft?.content],
  );
  const crosshair = useMemo(() => readCrosshair(document), [document]);
  const shareCode = useMemo(
    () => officialCrosshairShareCode(document),
    [document],
  );

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
      void flushCfgDraft().catch((error) =>
        notify("error", errorMessage(error)),
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [workspace.revision]);

  const lineNumbers = useMemo(
    () =>
      Array.from(
        { length: (preview?.content ?? draft?.content ?? "").split("\n").length },
        (_, index) => index + 1,
      ).join("\n"),
    [draft?.content, preview?.content],
  );

  const mutateContent = (content: string) => workspace.edit({ content });

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
      setVersions([]);
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

  const restore = async (version: CfgProfileVersion) => {
    if (!draft || !confirm("恢复该历史内容？当前内容会先进入历史。"))
      return;
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
      setView("source");
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const copyText = async (value: string, message: string) => {
    try {
      await writeText(value);
      notify("success", message);
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const editorValue = preview?.content ?? draft?.content ?? "";
  const saveLabel = workspace.saving
    ? "正在保存"
    : dirty
      ? "等待保存"
      : "已保存";
  const definitions = commandDefinitions.filter(
    (definition) => definition.section === section,
  );
  const known = new Set(definitions.map((definition) => definition.command));
  const sectionNodes = commandLinesForSection(document, section).filter(
    (node) => !known.has(node.normalizedCommand),
  );
  const bindKeyCounts = new Map<string, number>();
  for (const node of document.commands.filter(
    (item) => item.normalizedCommand === "bind",
  )) {
    const key = (node.args[0] ?? "").toLowerCase();
    bindKeyCounts.set(key, (bindKeyCounts.get(key) ?? 0) + 1);
  }

  return (
    <section className="cs2-workspace">
      <header className="page-heading cfg-heading">
        <div>
          <h1>CS2 CFG 工作台</h1>
          <p>可视化编辑当前方案；不会修改游戏实时文件，也不会启动游戏。</p>
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
          <FolderOpen />导入 CFG
        </button>
        <button className="button secondary" onClick={() => void createProfile()}>
          <Plus />新建 CFG
        </button>
        <button className="button secondary" onClick={() => void exportFile()}>
          <Download />导出 CFG
        </button>
        <code className="exec-preview">+exec {draft?.fileName ?? "autoexec.cfg"}</code>
        <span className={`cfg-save-state ${dirty ? "saving" : "saved"}`}>
          {saveLabel}
        </span>
      </div>

      <section className="code-workbench">
        <div className="editor-tabbar">
          <div className="cfg-view-switch" role="tablist" aria-label="CFG 编辑视图">
            <button
              role="tab"
              aria-selected={view === "visual"}
              className={view === "visual" ? "active" : ""}
              disabled={Boolean(preview)}
              onClick={() => setView("visual")}
            >
              <SlidersHorizontal />可视化配置
            </button>
            <button
              role="tab"
              aria-selected={view === "source"}
              className={view === "source" ? "active" : ""}
              onClick={() => setView("source")}
            >
              <Code2 />CFG 源码
            </button>
          </div>
          <div className="editor-file-name">
            <FileCode2 />{preview ? preview.name : draft?.fileName}
            {preview && <span>只读</span>}
          </div>
          {preview ? (
            <button onClick={() => setPreview(undefined)}>返回当前 CFG</button>
          ) : (
            draft && (
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
            )
          )}
        </div>

        {view === "visual" && !preview ? (
          <div className="cfg-visual-layout">
            <nav className="cfg-section-nav" aria-label="配置分区">
              {sectionOrder.map((id) => (
                <button
                  key={id}
                  className={section === id ? "active" : ""}
                  onClick={() => setSection(id)}
                >
                  <span>{sectionLabels[id]}</span>
                  <small>{commandLinesForSection(document, id).length}</small>
                </button>
              ))}
            </nav>
            <div className="cfg-settings-pane">
              <header>
                <div>
                  <h2>{sectionLabels[section]}</h2>
                  <p>修改会精准写回对应命令，并沿用 500ms 自动保存。</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() =>
                    mutateContent((() => {
                      const [command, args] = newCommandForSection(section);
                      return appendCommand(document.source, command, args);
                    })())
                  }
                >
                  <Plus />添加命令
                </button>
              </header>
              {definitions.map((definition) => (
                <ScalarSettingRow
                  key={definition.command}
                  definition={definition}
                  document={document}
                  onChange={(value) =>
                    mutateContent(
                      setScalarCommand(document.source, definition.command, value),
                    )
                  }
                  onRemove={() =>
                    mutateContent(
                      removeScalarCommand(document.source, definition.command),
                    )
                  }
                />
              ))}
              {sectionNodes.length > 0 && (
                <div className="cfg-command-table">
                  <div className="cfg-command-table-head">
                    <span>{section === "binds" ? "按键" : "命令"}</span>
                    <span>{section === "binds" ? "绑定命令" : "参数"}</span>
                  </div>
                  {sectionNodes.map((node) => (
                    <CommandRow
                      key={node.id}
                      node={node}
                      conflict={
                        node.normalizedCommand === "bind" &&
                        (bindKeyCounts.get((node.args[0] ?? "").toLowerCase()) ?? 0) >
                          1
                      }
                      onEdit={(command, argumentText) =>
                        mutateContent(
                          updateCommandNode(
                            document.source,
                            node.id,
                            command,
                            argumentText,
                          ),
                        )
                      }
                      onRemove={() =>
                        mutateContent(removeCommandNode(document.source, node.id))
                      }
                    />
                  ))}
                </div>
              )}
              {!definitions.length && !sectionNodes.length && (
                <p className="cfg-empty">当前分区还没有命令。</p>
              )}
            </div>
            <aside className="cfg-inspector">
              {section === "crosshair" ? (
                <>
                  <h3>准星检查面板</h3>
                  <CrosshairPreview
                    settings={crosshair.preview}
                    background={background}
                  />
                  <div className="crosshair-backgrounds">
                    {(["dark", "light", "scene"] as const).map((item) => (
                      <button
                        key={item}
                        className={background === item ? "active" : ""}
                        onClick={() => setBackground(item)}
                      >
                        {item === "dark"
                          ? "深色"
                          : item === "light"
                            ? "浅色"
                            : "场景色"}
                      </button>
                    ))}
                  </div>
                  <p className="muted-copy">近似预览，最终以游戏内渲染为准。</p>
                  <button
                    className="button secondary full-width"
                    disabled={!shareCode}
                    onClick={() =>
                      shareCode &&
                      void copyText(shareCode, "官方准星分享码已复制")
                    }
                  >
                    <Copy />复制官方分享码
                  </button>
                  {!shareCode && (
                    <p className="cfg-error">
                      缺少或无效参数：
                      {[...crosshair.missing, ...crosshair.invalid].join("、")}
                    </p>
                  )}
                  <button
                    className="button secondary full-width"
                    disabled={!cfgCrosshairCommands(document)}
                    onClick={() =>
                      void copyText(
                        cfgCrosshairCommands(document),
                        "CFG 准星命令已复制",
                      )
                    }
                  >
                    <Copy />复制 CFG 准星命令
                  </button>
                </>
              ) : (
                <>
                  <h3>分区检查</h3>
                  <p className="muted-copy">
                    已识别 {commandLinesForSection(document, section).length} 条命令。
                    未知命令仍按原顺序保留。
                  </p>
                </>
              )}
            </aside>
          </div>
        ) : (
          <>
            <div className="editor-surface">
              <pre ref={gutterRef} aria-hidden="true">
                {lineNumbers}
              </pre>
              <textarea
                aria-label={preview ? "运行文件只读预览" : "CFG 编辑器"}
                value={editorValue}
                readOnly={Boolean(preview)}
                spellCheck={false}
                onChange={(event) => workspace.edit({ content: event.target.value })}
                onClick={(event) => {
                  const before = event.currentTarget.value.slice(
                    0,
                    event.currentTarget.selectionStart,
                  );
                  const lines = before.split("\n");
                  setCursor({
                    line: lines.length,
                    column: lines.at(-1)!.length + 1,
                  });
                }}
                onScroll={(event) => {
                  if (gutterRef.current)
                    gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                }}
              />
            </div>
            <footer className="editor-statusbar">
              <span>{preview ? "只读预览" : saveLabel}</span>
              <span className="spacer" />
              <span>Ln {cursor.line}, Col {cursor.column}</span>
              <span>UTF-8</span><span>CFG</span>
            </footer>
          </>
        )}
      </section>

      <details className="cfg-tools">
        <summary>历史版本与运行文件</summary>
        <div className="cfg-tool-tabs">
          <button
            className={toolTab === "history" ? "active" : ""}
            onClick={() => setToolTab("history")}
          >
            <History />历史版本
          </button>
          <button
            className={toolTab === "runtime" ? "active" : ""}
            onClick={() => setToolTab("runtime")}
          >
            <FolderOpen />运行文件
          </button>
        </div>
        <div className="cfg-tool-content">
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
