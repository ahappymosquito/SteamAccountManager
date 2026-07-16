/** Account filter behavior for search and status combinations. */
import { describe,expect,it } from "vitest";
import { filterAccounts } from "./filter";
import type { Account } from "./types";
const base:Account={id:"1",steamId64:"76561198000000001",accountName:"alpha",personaName:"Player",localAvailable:true,createdAt:"2026-01-01T00:00:00Z",updatedAt:"2026-01-01T00:00:00Z",favorite:false,tags:["主力"]};
describe("filterAccounts",()=>{it("searches aliases and tags",()=>{expect(filterAccounts([base],"主力")).toHaveLength(1);expect(filterAccounts([base],"missing")).toHaveLength(0)});it("combines local and favorite filters",()=>{expect(filterAccounts([base],"",true,true)).toHaveLength(0);expect(filterAccounts([{...base,favorite:true}],"",true,true)).toHaveLength(1)})});
