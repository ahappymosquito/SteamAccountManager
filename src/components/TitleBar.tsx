/** Theme-aware custom Windows title bar with native window controls. */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Minus, Palette, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import type { Theme } from "../lib/types";
import { applyTheme, themes } from "../lib/themes";

export function TitleBar({theme,onThemeChange}:{theme:Theme;onThemeChange:(theme:Theme)=>void}){
  const appWindow=getCurrentWindow();
  const select=(value:Theme)=>{applyTheme(value);onThemeChange(value)};
  const startDrag=(event:MouseEvent<HTMLElement>)=>{
    if(event.button===0&&!(event.target as HTMLElement).closest("button"))void appWindow.startDragging();
  };
  const toggleMaximize=(event:MouseEvent<HTMLElement>)=>{
    if(!(event.target as HTMLElement).closest("button"))void appWindow.toggleMaximize();
  };
  return <header className="window-titlebar" data-tauri-drag-region onMouseDown={startDrag} onDoubleClick={toggleMaximize}>
    <div className="window-title" data-tauri-drag-region><img src="/favicon.svg" alt=""/><span>Steam Account Manager</span></div>
    <div className="window-drag-space" data-tauri-drag-region/>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button className="titlebar-button theme-trigger" aria-label="切换主题"><Palette/></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="theme-menu" sideOffset={6} align="end">
        {(["浅色","夜间"] as const).map(mode=><div className="theme-group" key={mode}><span>{mode}</span>{themes.filter(item=>item.mode===mode).map(item=><DropdownMenu.Item className="theme-menu-item" key={item.value} onSelect={()=>select(item.value)}><i style={{background:item.swatch}}/><span>{item.name}</span>{theme===item.value&&<b>当前</b>}</DropdownMenu.Item>)}</div>)}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
    <button className="titlebar-button" aria-label="最小化" onClick={()=>void appWindow.minimize()}><Minus/></button>
    <button className="titlebar-button" aria-label="最大化或还原" onClick={()=>void appWindow.toggleMaximize()}><Square/></button>
    <button className="titlebar-button close" aria-label="关闭" onClick={()=>void appWindow.close()}><X/></button>
  </header>
}
