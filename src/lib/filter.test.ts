/** Account filter coverage for search, state and multi-platform linkage. */
import { describe, expect, it } from "vitest";
import {
  applyAccountOrder,
  filterAccounts,
  normalizeAccountOrder,
  sortAccounts,
} from "./filter";
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

  it("keeps unranked accounts below ranked accounts and uses last season inside that group", () => {
    const ranked = {
      ...base,
      id: "ranked",
      playerRanks: [{
        platform: "5e",
        rankingState: "ranked" as const,
        score: 1800,
        stale: false,
      }],
    };
    const placement = {
      ...base,
      id: "placement",
      playerRanks: [{
        platform: "5e",
        rankingState: "placement" as const,
        previousSeasonScore: 2200,
        placementMatches: 3,
        stale: false,
      }],
    };
    const unknown = { ...base, id: "unknown", playerRanks: [] };

    expect(sortAccounts([ranked, unknown, placement], "score_desc").map(({ id }) => id))
      .toEqual(["unknown", "placement", "ranked"]);
    expect(sortAccounts([ranked, unknown, placement], "score_asc").map(({ id }) => id))
      .toEqual(["unknown", "placement", "ranked"]);
  });

  it("keeps ties stable while scoreless unranked accounts stay first", () => {
    const equal = (id: string) => ({
      ...base,
      id,
      playerRanks: [{
        platform: "5e",
        rankingState: "ranked" as const,
        score: 1800,
        stale: false,
      }],
    });
    const unavailable = (id: string) => ({ ...base, id, playerRanks: [] });

    expect(sortAccounts(
      [equal("first"), unavailable("unknown-1"), equal("second"), unavailable("unknown-2")],
      "score_desc",
    ).map(({ id }) => id)).toEqual(["unknown-1", "unknown-2", "first", "second"]);
  });

  it("normalizes and applies a persisted Steam account order", () => {
    const second = { ...base, id: "2", steamId64: "76561198000000002" };
    const third = { ...base, id: "3", steamId64: "76561198000000003" };
    const order = normalizeAccountOrder(
      [base, second, third],
      [second.steamId64, "missing", second.steamId64],
    );
    expect(order).toEqual([second.steamId64, base.steamId64, third.steamId64]);
    expect(applyAccountOrder([base, second, third], order).map(({ id }) => id))
      .toEqual(["2", "1", "3"]);
  });
});
