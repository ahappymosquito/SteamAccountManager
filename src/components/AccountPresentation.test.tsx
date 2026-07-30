/** Regression tests for account platform badges and current Steam identity copy. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPlatformBadges } from "./AccountPlatformBadges";
import { CurrentSteamStatus } from "./CurrentSteamStatus";
import type { Account } from "../lib/types";

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
  playerRanks: [
    { platform: "5e", rankName: "S", score: 2401.1, stale: false },
    { platform: "perfectworld", rankName: "B+", stale: false },
  ],
};

afterEach(cleanup);

describe("account presentation", () => {
  it("shows platform name, rank and available score without duplicate lookup copy", () => {
    render(<AccountPlatformBadges account={account} />);

    expect(screen.getByRole("button", { name: "编辑5E账号资料" }))
      .toHaveTextContent("5ES · 2401");
    expect(screen.getByRole("button", { name: "编辑完美平台账号资料" }))
      .toHaveTextContent("完美平台B+");
  });

  it("hides unlinked platform shortcuts from the account row", () => {
    const onSelect = vi.fn();
    render(
      <AccountPlatformBadges
        account={{ ...account, platformCodes: [], playerRanks: [] }}
        onSelect={onSelect}
      />,
    );

    expect(screen.queryByText(/待填写/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑5E账号资料" }))
      .not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("highlights a linked platform and reports the selected platform", () => {
    const onSelect = vi.fn();
    render(<AccountPlatformBadges account={account} onSelect={onSelect} />);

    const shortcut = screen.getByRole("button", { name: "编辑5E账号资料" });
    expect(shortcut).toHaveClass("linked");
    fireEvent.click(shortcut);
    expect(onSelect).toHaveBeenCalledWith("5e");
  });

  it("shows placement progress without exposing a temporary score", () => {
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
      />,
    );

    expect(screen.getByText("定级赛 · 已打 3 场")).toBeInTheDocument();
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
