/** Transient navigation, filtering, selection and notification state. */
import { create } from "zustand";

import type { PlatformCode } from "./lib/types";
import type { AccountSort } from "./lib/filter";

export type Page = "accounts"|"cs2"|"platforms"|"logs"|"settings";
export type PlatformFilter = ""|PlatformCode|"unlinked";
export type NoticeKind = "success"|"warning"|"error";
type Notice = { kind:NoticeKind; text:string } | null;
type UiState = { page:Page; query:string; favoriteOnly:boolean; platform:PlatformFilter; accountSort:AccountSort; selectedTags:string[]; selectedId?:string; notice:Notice; setPage:(page:Page)=>void; setQuery:(query:string)=>void; setFavoriteOnly:(value:boolean)=>void; setPlatform:(value:PlatformFilter)=>void; setAccountSort:(value:AccountSort)=>void; setSelectedTags:(value:string[])=>void; select:(id?:string)=>void; notify:(notice:Notice)=>void };
export const useUi: () => UiState = create<UiState>((set)=>({page:"accounts",query:"",favoriteOnly:false,platform:"",accountSort:"recent",selectedTags:[],notice:null,setPage:(page)=>set({page}),setQuery:(query)=>set({query}),setFavoriteOnly:(favoriteOnly)=>set({favoriteOnly}),setPlatform:(platform)=>set({platform,accountSort:platform==="5e"?"score_desc":"recent"}),setAccountSort:(accountSort)=>set({accountSort}),setSelectedTags:(selectedTags)=>set({selectedTags}),select:(selectedId)=>set({selectedId}),notify:(notice)=>set({notice})}));
