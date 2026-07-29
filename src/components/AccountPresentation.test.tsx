/** Regression tests for account platform badges and current Steam identity copy. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

describe("account presentation", () => {
  it("shows platform name, rank and available score without duplicate lookup copy", () => {
    render(<AccountPlatformBadges account={account} />);

    expect(screen.getByText("5E · S · 2401")).toBeInTheDocument();
    expect(screen.getByText("完美世界 · B+")).toBeInTheDocument();
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
