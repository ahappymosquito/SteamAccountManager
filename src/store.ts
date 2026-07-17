/** Transient navigation, filtering, selection and notification state. */
import { create } from "zustand";

import type { PlatformCode } from "./lib/types";

export type Page = "accounts"|"logs"|"settings";
export type PlatformFilter = ""|PlatformCode|"unlinked";
type Notice = { kind:"success"|"error"; text:string } | null;
type UiState = { page:Page; query:string; localOnly:boolean; favoriteOnly:boolean; platform:PlatformFilter; selectedId?:string; notice:Notice; setPage:(page:Page)=>void; setQuery:(query:string)=>void; setLocalOnly:(value:boolean)=>void; setFavoriteOnly:(value:boolean)=>void; setPlatform:(value:PlatformFilter)=>void; select:(id?:string)=>void; notify:(notice:Notice)=>void };
export const useUi: () => UiState = create<UiState>((set)=>({page:"accounts",query:"",localOnly:false,favoriteOnly:false,platform:"",notice:null,setPage:(page)=>set({page}),setQuery:(query)=>set({query}),setLocalOnly:(localOnly)=>set({localOnly}),setFavoriteOnly:(favoriteOnly)=>set({favoriteOnly}),setPlatform:(platform)=>set({platform}),select:(selectedId)=>set({selectedId}),notify:(notice)=>set({notice})}));
