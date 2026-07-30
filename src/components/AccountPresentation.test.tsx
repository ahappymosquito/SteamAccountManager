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

    expect(screen.getByText("5E · S · 2401")).toBeInTheDocument();
    expect(screen.getByText("完美平台 · B+")).toBeInTheDocument();
  });

  it("always renders both platform shortcuts and reports the selected platform", () => {
    const onSelect = vi.fn();
    render(
      <AccountPlatformBadges
        account={{ ...account, platformCodes: [], playerRanks: [] }}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("完美平台 · 待填写")).toBeInTheDocument();
    expect(screen.getByText("5E · 待填写")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "编辑5E账号资料" }),
    );
    expect(onSelect).toHaveBeenCalledWith("5e");
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
