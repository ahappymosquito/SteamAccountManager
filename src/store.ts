/** Transient navigation, filtering, selection and notification state. */
import { create } from "zustand";

import type { PlatformCode } from "./lib/types";

export type Page = "accounts"|"cs2"|"platforms"|"logs"|"settings";
export type PlatformFilter = ""|PlatformCode|"unlinked";
type Notice = { kind:"success"|"error"; text:string } | null;
type UiState = { page:Page; query:string; favoriteOnly:boolean; platform:PlatformFilter; selectedTags:string[]; selectedId?:string; notice:Notice; setPage:(page:Page)=>void; setQuery:(query:string)=>void; setFavoriteOnly:(value:boolean)=>void; setPlatform:(value:PlatformFilter)=>void; setSelectedTags:(value:string[])=>void; select:(id?:string)=>void; notify:(notice:Notice)=>void };
export const useUi: () => UiState = create<UiState>((set)=>({page:"accounts",query:"",favoriteOnly:false,platform:"",selectedTags:[],notice:null,setPage:(page)=>set({page}),setQuery:(query)=>set({query}),setFavoriteOnly:(favoriteOnly)=>set({favoriteOnly}),setPlatform:(platform)=>set({platform}),setSelectedTags:(selectedTags)=>set({selectedTags}),select:(selectedId)=>set({selectedId}),notify:(notice)=>set({notice})}));
