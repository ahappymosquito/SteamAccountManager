/** Transient navigation, filtering, selection and notification state. */
import { create } from "zustand";

export type Page = "accounts"|"logs"|"settings";
type Notice = { kind:"success"|"error"; text:string } | null;
type UiState = { page:Page; query:string; localOnly:boolean; favoriteOnly:boolean; group:string; selectedId?:string; notice:Notice; setPage:(page:Page)=>void; setQuery:(query:string)=>void; setLocalOnly:(value:boolean)=>void; setFavoriteOnly:(value:boolean)=>void; setGroup:(value:string)=>void; select:(id?:string)=>void; notify:(notice:Notice)=>void };
export const useUi: () => UiState = create<UiState>((set)=>({page:"accounts",query:"",localOnly:false,favoriteOnly:false,group:"",notice:null,setPage:(page)=>set({page}),setQuery:(query)=>set({query}),setLocalOnly:(localOnly)=>set({localOnly}),setFavoriteOnly:(favoriteOnly)=>set({favoriteOnly}),setGroup:(group)=>set({group}),select:(selectedId)=>set({selectedId}),notify:(notice)=>set({notice})}));
