/** Player data panel tests for snapshot rendering, stale warnings, and forced refresh. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformLink, PlayerSnapshot } from "../lib/types";

const mocks = vi.hoisted(() => ({ playerData: vi.fn() }));
vi.mock("../lib/api", () => ({ api: { playerData: mocks.playerData } }));

import { PlayerDataPanel } from "./PlayerDataPanel";

const link: PlatformLink = {
  id: "link-5e",
  steamAccountId: "account-1",
  platformCode: "5e",
  externalId: "123456",
  status: "user_confirmed",
};

const snapshot: PlayerSnapshot = {
  platform: "5e",
  externalId: "123456",
  nickname: "测试玩家",
  rankName: "优先大师",
  elo: 1850,
  eloSource: "latest_match",
  stats: {
    sampleSize: 1,
    kills: 20,
    deaths: 10,
    kd: 2,
    rating: 1.25,
    adr: 92.4,
    headshotRate: 55,
    winRate: 100,
  },
  recentMatches: [{
    matchId: "match-1",
    map: "de_mirage",
    result: "win",
    score: "13:8",
    kills: 20,
    deaths: 10,
    assists: 4,
    rating: 1.25,
    adr: 92.4,
  }],
  capabilities: ["profile", "recent_matches"],
  warnings: ["一场详情读取失败"],
  fetchedAt: "2026-07-27T08:00:00Z",
  stale: true,
};

describe("PlayerDataPanel", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.playerData.mockResolvedValue(snapshot);
  });

  it("renders the normalized snapshot and stale partial-data state", async () => {
    render(<PlayerDataPanel link={link} />);

    expect(await screen.findByText("测试玩家 · 优先大师")).toBeInTheDocument();
    expect(screen.getByText("1850")).toBeInTheDocument();
    expect(screen.getByText("2.00")).toBeInTheDocument();
    expect(screen.getByText("55.0%")).toBeInTheDocument();
    expect(screen.getByText("de_mirage")).toBeInTheDocument();
    expect(screen.getByText("缓存数据")).toBeInTheDocument();
    expect(screen.getByText("一场详情读取失败")).toBeInTheDocument();
  });

  it("forces a refresh from the explicit refresh control", async () => {
    render(<PlayerDataPanel link={link} />);
    await screen.findByText("测试玩家 · 优先大师");

    fireEvent.click(screen.getByRole("button", { name: "刷新 5E 玩家数据" }));

    await waitFor(() =>
      expect(mocks.playerData).toHaveBeenLastCalledWith("link-5e", true),
    );
  });

  it("labels Perfect World scores as season records without inventing match stats", async () => {
    mocks.playerData.mockResolvedValue({
      ...snapshot,
      platform: "perfectworld",
      externalId: "76561198000000001",
      rankName: "B+",
      elo: 1888,
      eloSource: "latest_season_record",
      stats: { sampleSize: 0, kills: 0, deaths: 0 },
      recentMatches: [],
      warnings: [],
      stale: false,
    });
    render(<PlayerDataPanel link={{ ...link, platformCode: "perfectworld" }} />);

    expect(await screen.findByText("赛季记录分数")).toBeInTheDocument();
    expect(screen.getByText("1888")).toBeInTheDocument();
    expect(screen.getByText("按 SteamID 自动匹配")).toBeInTheDocument();
    expect(screen.queryByText("KD")).not.toBeInTheDocument();
    expect(screen.queryByText("最近比赛")).not.toBeInTheDocument();
  });
});
