/** Theme catalog and persistence shared by the custom title bar and app startup. */
import type { Theme } from "./types";

export const defaultTheme:Theme="glacier";

export const themes:{value:Theme;name:string;mode:"浅色"|"夜间";swatch:string}[]=[
  {value:"glacier",name:"晴空蓝",mode:"浅色",swatch:"oklch(.58 .19 250)"},
  {value:"daylight",name:"薄荷白",mode:"浅色",swatch:"oklch(.56 .14 165)"},
  {value:"lilac",name:"淡紫雾",mode:"浅色",swatch:"oklch(.60 .16 300)"},
  {value:"aurora",name:"深海蓝",mode:"夜间",swatch:"oklch(.72 .17 238)"},
  {value:"violet",name:"夜幕紫",mode:"夜间",swatch:"oklch(.72 .18 300)"},
  {value:"mint",name:"墨绿青",mode:"夜间",swatch:"oklch(.76 .14 170)"},
];

export function isTheme(value:unknown):value is Theme{
  return typeof value==="string"&&themes.some(theme=>theme.value===value);
}

export function renderTheme(theme:Theme){
  document.documentElement.dataset.theme=theme;
}

export function applyTheme(theme:Theme){
  renderTheme(theme);
  localStorage.setItem("sam-theme",theme);
}

export function storedTheme():Theme|undefined{
  const value=localStorage.getItem("sam-theme");
  return isTheme(value)?value:undefined;
}

export function resolveTheme(local:Theme|undefined,configured:unknown):Theme{
  if(local)return local;
  return isTheme(configured)?configured:defaultTheme;
}

export function savedTheme():Theme{
  return storedTheme()??defaultTheme;
}
