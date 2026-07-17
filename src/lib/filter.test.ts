/** Account filter coverage for search, state and multi-platform linkage. */
import { describe, expect, it } from "vitest";
import { filterAccounts } from "./filter";
import type { Account } from "./types";

const base: Account = { id: "1", steamId64: "76561198000000001", accountName: "alpha", personaName: "Player", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", favorite: false, tags: ["主力", "竞技"], platformCodes: ["5e", "faceit"] };

describe("filterAccounts", () => {
  it("searches aliases and tags without exposing Steam ID search", () => {
    expect(filterAccounts([base], "主力")).toHaveLength(1);
    expect(filterAccounts([base], base.steamId64)).toHaveLength(0);
  });

  it("combines local and favorite filters", () => {
    expect(filterAccounts([base], "", true)).toHaveLength(0);
    expect(filterAccounts([{ ...base, favorite: true }], "", true)).toHaveLength(1);
  });

  it("matches every linked platform and unlinked accounts", () => {
    expect(filterAccounts([base], "", false, "5e")).toHaveLength(1);
    expect(filterAccounts([base], "", false, "faceit")).toHaveLength(1);
    expect(filterAccounts([base], "", false, "unlinked")).toHaveLength(0);
    expect(filterAccounts([{ ...base, platformCodes: [] }], "", false, "unlinked")).toHaveLength(1);
  });

  it("requires every selected tag", () => {
    expect(filterAccounts([base], "", false, "", ["主力", "竞技"])).toHaveLength(1);
    expect(filterAccounts([base], "", false, "", ["主力", "休闲"])).toHaveLength(0);
  });
});
