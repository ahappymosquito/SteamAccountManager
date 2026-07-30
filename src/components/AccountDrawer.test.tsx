/** Drawer regression coverage for profile editing and read-only platform cards. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, PlatformLink } from "../lib/types";

const mocks = vi.hoisted(() => ({
  links: vi.fn(),
  playerData: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: mocks.writeText,
}));
vi.mock("../lib/api", () => ({ api: mocks }));

import { AccountDrawer } from "./AccountDrawer";

const account: Account = {
  id: "account-1",
  steamId64: "76561198000000001",
  accountName: "alpha",
  personaName: "玩家",
  alias: "主力",
  remark: "竞技账号",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  favorite: true,
  tags: ["竞技"],
  platformCodes: ["5e"],
  playerRanks: [{
    platform: "5e",
    rankingState: "placement",
    placementMatches: 3,
    previousSeasonScore: 2200,
    stale: false,
  }],
};

const fiveE: PlatformLink = {
  id: "fivee-link",
  steamAccountId: account.id,
  platformCode: "5e",
  externalId: "塔菲喵",
  displayName: "塔菲喵",
  loginAccount: "five-login",
  loginPassword: "plain-password",
  remark: "需要短信验证",
  status: "user_confirmed",
};

const renderDrawer = (
  props: Partial<React.ComponentProps<typeof AccountDrawer>> = {},
) =>
  render(
    <AccountDrawer
      account={account}
      tagOptions={[]}
      open
      onOpenChange={vi.fn()}
      onSave={vi.fn()}
      notify={vi.fn()}
      onChanged={vi.fn()}
      {...props}
    />,
  );

afterEach(cleanup);

describe("AccountDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.links.mockResolvedValue([fiveE]);
    mocks.writeText.mockResolvedValue(undefined);
    mocks.playerData.mockResolvedValue({
      platform: "5e",
      externalId: "塔菲喵",
      nickname: "塔菲喵",
      rankingState: "placement",
      placementMatches: 3,
      stats: { sampleSize: 0, kills: 0, deaths: 0 },
      recentMatches: [],
      capabilities: [],
      warnings: [],
      fetchedAt: "2026-07-27T08:00:00Z",
      stale: false,
    });
  });

  it("keeps Steam profile fields editable while platform editing is absent", async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    expect(screen.getByDisplayValue("主力")).toBeInTheDocument();
    expect(screen.queryByText("保存并查询")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.links).toHaveBeenCalledWith(account.id));
  });

  it("renders platform cards collapsed and lazily loads stats on expansion", async () => {
    renderDrawer();
    const card = await screen.findByRole("button", { name: /5E.*塔菲喵/ });
    expect(card).toHaveAttribute("aria-expanded", "false");
    expect(mocks.playerData).not.toHaveBeenCalled();

    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(mocks.playerData).toHaveBeenCalledWith(fiveE.id, false),
    );
    expect(screen.getByText("未定级 · 已打 3 场")).toBeInTheDocument();
  });

  it("masks, reveals, and copies credentials inside an expanded card", async () => {
    renderDrawer();
    fireEvent.click(await screen.findByRole("button", { name: /5E.*塔菲喵/ }));
    expect(screen.getByText("***")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(screen.getByText("plain-password")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制5E登录账号" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("five-login"));
  });
});
