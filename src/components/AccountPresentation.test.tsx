/** Regression coverage for compact platform shortcuts and Steam identity copy. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Account } from "../lib/types";
import { AccountPlatformBadges } from "./AccountPlatformBadges";
import { CurrentSteamStatus } from "./CurrentSteamStatus";

const account: Account = {
  id: "account-1",
  steamId64: "76561198000000001",
  accountName: "login_name",
  personaName: "中文昵称",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  favorite: false,
  tags: [],
  platformCodes: ["5e", "perfectworld"],
  platformSummaries: [
    { platformCode: "5e", displayName: "很长的5E用户名" },
    { platformCode: "perfectworld", displayName: "完美玩家" },
  ],
  playerRanks: [
    {
      platform: "5e",
      rankName: "S",
      score: 2401.1,
      rankingState: "ranked",
      stale: false,
    },
  ],
};

afterEach(cleanup);

describe("account presentation", () => {
  it("shows only platform and username until the 5E filter requests score", () => {
    const { rerender } = render(<AccountPlatformBadges account={account} />);
    expect(screen.getByRole("button", { name: "编辑5E账号资料" }))
      .toHaveTextContent("5E很长的5E用户名");
    expect(screen.queryByText("2401")).not.toBeInTheDocument();

    rerender(<AccountPlatformBadges account={account} showFiveEScore />);
    expect(screen.getByText("2401")).toBeInTheDocument();
  });

  it("keeps unlinked shortcuts gray without showing pending copy", () => {
    render(
      <AccountPlatformBadges
        account={{ ...account, platformCodes: [], platformSummaries: [] }}
      />,
    );
    expect(screen.queryByText(/待填写/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑5E账号资料" }))
      .toHaveClass("unlinked");
    expect(screen.getByRole("button", { name: "编辑完美账号资料" }))
      .toHaveClass("unlinked");
  });

  it("reports a selected platform from filled or empty shortcuts", () => {
    const onSelect = vi.fn();
    render(<AccountPlatformBadges account={account} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑5E账号资料" }));
    expect(onSelect).toHaveBeenCalledWith("5e");
  });

  it("shows placement progress only in the 5E filtered context", () => {
    render(
      <AccountPlatformBadges
        account={{
          ...account,
          platformCodes: ["5e"],
          playerRanks: [{
            platform: "5e",
            rankingState: "placement",
            placementMatches: 3,
            previousSeasonScore: 2200,
            stale: false,
          }],
        }}
        showFiveEScore
      />,
    );
    expect(screen.getByText("未定级 · 已打 3 场")).toBeInTheDocument();
    expect(screen.queryByText("2200")).not.toBeInTheDocument();
  });

  it("prefers the Chinese Steam persona name for locally confirmed status", () => {
    render(
      <CurrentSteamStatus
        status={{
          kind: "locally_confirmed",
          accountName: "login_name",
          personaName: "中文昵称",
          steamId64: account.steamId64,
          steamRunning: true,
        }}
      />,
    );
    expect(screen.getByText("中文昵称")).toBeInTheDocument();
    expect(screen.queryByText("login_name")).not.toBeInTheDocument();
  });
});
