/** CS2 cfg profile editor, account assignment, official notes, and runtime previews. */
import { useEffect,useMemo,useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Clock3,FileCode2,FolderOpen,History,Plus,RotateCcw,Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { Account,AccountCfgAssignment,AppError,CfgProfile,CfgProfileVersion,Cs2RuntimeFile } from "../lib/types";

const errorMessage=(error:unknown)=>(error as AppError)?.message||"操作失败";
const commandNotes:Record<string,{description:string;source:string}>={
  bind:{description:"将按键绑定到命令。包含空格的命令应使用引号。",source:"https://developer.valvesoftware.com/wiki/Bind"},
  unbind:{description:"移除指定按键的绑定。",source:"https://developer.valvesoftware.com/wiki/Bind"},
  alias:{description:"为一组控制台命令定义简短名称。",source:"https://developer.valvesoftware.com/wiki/Alias"},
  exec:{description:"执行另一个 cfg 文件。",source:"https://developer.valvesoftware.com/wiki/Exec"},
  host_writeconfig:{description:"请求游戏写回带归档标记的设置。",source:"https://developer.valvesoftware.com/wiki/DevMsg"},
  fps_max:{description:"限制客户端最大帧率；0 通常表示不限制。",source:"https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables"},
  sensitivity:{description:"鼠标灵敏度倍率。",source:"https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables"},
  volume:{description:"游戏主音量。",source:"https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables"},
};

export function Cs2Page({accounts,notify}:{accounts:Account[];notify:(kind:"success"|"error",text:string)=>void}){
  const[profiles,setProfiles]=useState<CfgProfile[]>([]);const[activeId,setActiveId]=useState<string>();const[name,setName]=useState("");const[content,setContent]=useState("");const[dirty,setDirty]=useState(false);const[assignments,setAssignments]=useState<AccountCfgAssignment[]>([]);const[runtimeFiles,setRuntimeFiles]=useState<Cs2RuntimeFile[]>([]);const[preview,setPreview]=useState<{path:string;content:string}>();const[versions,setVersions]=useState<CfgProfileVersion[]>([]);const[saving,setSaving]=useState(false);
  const active=profiles.find(profile=>profile.id===activeId);
  const load=async()=>{const[nextProfiles,nextAssignments,nextRuntime]=await Promise.all([api.cfgProfiles(),api.cfgAssignments(),api.cs2RuntimeFiles().catch(()=>[])]);setProfiles(nextProfiles);setAssignments(nextAssignments);setRuntimeFiles(nextRuntime);if(!activeId&&nextProfiles[0])setActiveId(nextProfiles[0].id)};
  useEffect(()=>{void load().catch(error=>notify("error",errorMessage(error)))},[]);
  useEffect(()=>{if(!active)return;setName(active.name);setContent(active.content);setDirty(false);api.cfgVersions(active.id).then(setVersions).catch(()=>setVersions([]))},[activeId,active?.updatedAt]);
  useEffect(()=>{if(!dirty||!active)return;const timer=window.setTimeout(async()=>{setSaving(true);try{await api.saveCfgProfile(active.id,name,content);setProfiles(items=>items.map(item=>item.id===active.id?{...item,name,content,updatedAt:new Date().toISOString()}:item));setDirty(false)}catch(error){notify("error",errorMessage(error))}finally{setSaving(false)}},500);return()=>window.clearTimeout(timer)},[dirty,name,content,active?.id]);
  const notes=useMemo(()=>{const seen=new Set<string>();return content.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith("//")).map(line=>line.split(/\s+/)[0].toLowerCase()).filter(command=>!seen.has(command)&&Boolean(seen.add(command))).map(command=>({command,note:commandNotes[command]}))},[content]);
  const create=async()=>{const suffix=Date.now().toString().slice(-6);try{const profile=await api.createCfgProfile(`新配置 ${profiles.length+1}`,`profile-${suffix}.cfg`,"// 在此输入 CS2 控制台命令\n");setProfiles(items=>[...items,profile]);setActiveId(profile.id);notify("success","已创建 cfg 方案")}catch(error){notify("error",errorMessage(error))}};
  const importFile=async()=>{const path=await open({multiple:false,filters:[{name:"CS2 cfg",extensions:["cfg"]}],title:"导入 CS2 cfg"});if(typeof path!=="string")return;try{const profile=await api.importCfgProfile(path);setProfiles(items=>[...items,profile]);setActiveId(profile.id);notify("success","已复制到 cfg 方案库")}catch(error){notify("error",errorMessage(error))}};
  const remove=async()=>{if(!active||!confirm(`删除“${active.name}”？账号绑定会同时解除。`))return;try{await api.deleteCfgProfile(active.id);const remaining=profiles.filter(item=>item.id!==active.id);setProfiles(remaining);setActiveId(remaining[0]?.id);await load();notify("success","cfg 方案已删除")}catch(error){notify("error",errorMessage(error))}};
  const assignmentFor=(accountId:string)=>assignments.find(item=>item.steamAccountId===accountId)?.profileId||"";
  const assign=async(accountId:string,profileId:string)=>{try{await api.assignCfgProfile(accountId,profileId||undefined);setAssignments(await api.cfgAssignments());notify("success","账号 cfg 已更新")}catch(error){notify("error",errorMessage(error))}};
  const showPreview=async(file:Cs2RuntimeFile)=>{try{setPreview({path:file.path,content:await api.previewCs2RuntimeFile(file.path)})}catch(error){notify("error",errorMessage(error))}};
  const restore=async(version:CfgProfileVersion)=>{if(!active||!confirm("恢复该历史内容？当前内容会先自动进入历史。"))return;try{const restored=await api.restoreCfgVersion(active.id,version.id);setContent(restored);setDirty(true);notify("success","历史内容已载入，正在保存")}catch(error){notify("error",errorMessage(error))}};
  return <section className="cs2-workspace">
    <header className="page-heading"><div><h1>CS2 配置</h1><p>管理可复用 cfg，切换账号时自动复制并校验启动参数。</p></div><div className="heading-actions"><button className="button secondary" onClick={()=>void importFile()}><FolderOpen/>导入 cfg</button><button className="button primary" onClick={()=>void create()}><Plus/>新建方案</button></div></header>
    <div className="cfg-layout">
      <aside className="cfg-sidebar" aria-label="cfg 方案"><strong>配置方案</strong>{profiles.map(profile=><button key={profile.id} className={profile.id===activeId?"active":""} onClick={()=>setActiveId(profile.id)}><FileCode2/><span>{profile.name}<small>{profile.fileName}</small></span></button>)}{!profiles.length&&<p>还没有 cfg。新建或导入一个方案开始编辑。</p>}</aside>
      <main className="cfg-editor-panel">{active?<><div className="cfg-editor-toolbar"><input aria-label="方案名称" value={name} onChange={event=>{setName(event.target.value);setDirty(true)}}/><code>{active.fileName}</code><span className={saving||dirty?"saving":"saved"}>{saving||dirty?"正在保存":"已保存"}</span><button className="icon-button danger" aria-label="删除 cfg" onClick={()=>void remove()}><Trash2/></button></div><textarea className="cfg-editor" spellCheck={false} value={content} onChange={event=>{setContent(event.target.value);setDirty(true)}} aria-label="cfg 编辑器"/></>:<div className="empty compact"><FileCode2/><h2>选择一个 cfg 方案</h2><p>命令说明只在编辑器中展示，不会写入文件。</p></div>}</main>
      <aside className="cfg-inspector"><section><h2>命令备注</h2>{notes.length?notes.map(({command,note})=><div className="command-note" key={command}><code>{command}</code><p>{note?.description||"暂无可核验的官方说明，仍允许保存。"}</p>{note&&<button onClick={()=>void openUrl(note.source)}>查看来源</button>}</div>):<p className="muted-copy">输入命令后，这里会显示匹配的官方说明。</p>}</section><section><h2><History/>历史版本</h2>{versions.slice(0,5).map(version=><button className="history-row" key={version.id} onClick={()=>void restore(version)}><Clock3/>{new Date(version.createdAt).toLocaleString("zh-CN")}<RotateCcw/></button>)}{!versions.length&&<p className="muted-copy">修改后自动保留最近 10 个版本。</p>}</section></aside>
    </div>
    <section className="page-panel assignment-panel"><div className="panel-heading"><div><h2>账号启动配置</h2><p>每个 Steam 账号选择一个 cfg；不选择则切换时不处理 CS2 配置。</p></div></div><div className="assignment-list">{accounts.map(account=><label key={account.id}><span>{account.personaName||account.alias||account.accountName||"未命名账号"}<small>…{account.steamId64.slice(-6)}</small></span><select value={assignmentFor(account.id)} onChange={event=>void assign(account.id,event.target.value)}><option value="">不应用 cfg</option>{profiles.map(profile=><option value={profile.id} key={profile.id}>{profile.name} · {profile.fileName}</option>)}</select></label>)}</div></section>
    <section className="page-panel runtime-panel"><div className="panel-heading"><div><h2>CS2 运行时配置预览</h2><p>只读查看 userdata 中实际存在的文件；Valve 未保证这些文件名长期不变。</p></div></div><div className="runtime-browser"><div>{runtimeFiles.map(file=><button key={file.path} className={preview?.path===file.path?"active":""} onClick={()=>void showPreview(file)}><span>账号 …{file.steamId64.slice(-6)}</span><strong>{file.name}</strong><small>{Math.ceil(file.size/1024)} KB</small></button>)}{!runtimeFiles.length&&<p className="muted-copy">未检测到 CS2 运行时配置。</p>}</div><pre>{preview?.content||"选择文件后在这里预览内容"}</pre></div></section>
  </section>
}
