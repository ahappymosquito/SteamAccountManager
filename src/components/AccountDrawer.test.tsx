/** Drawer behavior coverage for identity privacy, edit mode and local profile fields. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../lib/types";

const mocks = vi.hoisted(() => ({
  links: vi.fn(),
  saveLink: vi.fn(),
  deleteLink: vi.fn(),
  playerData: vi.fn(),
  platformCredentialStatus: vi.fn(),
  autoLinkPerfectWorld: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
vi.mock("../lib/api", () => ({ api: mocks }));
import { AccountDrawer } from "./AccountDrawer";

const account: Account = { id: "account-1", steamId64: "76561198000000001", accountName: "alpha", personaName: "玩家", alias: "主力", remark: "竞技账号", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", favorite: true, tags: ["竞技"], platformCodes: [] };
afterEach(cleanup);

describe("AccountDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.links.mockResolvedValue([]);
    mocks.saveLink.mockResolvedValue(undefined);
    mocks.deleteLink.mockResolvedValue(undefined);
    mocks.playerData.mockResolvedValue({
      platform: "5e",
      externalId: "123456",
      nickname: "已验证玩家",
      stats: { sampleSize: 0, kills: 0, deaths: 0 },
      recentMatches: [],
      capabilities: [],
      warnings: [],
      fetchedAt: "2026-07-27T08:00:00Z",
      stale: false,
    });
    mocks.platformCredentialStatus.mockResolvedValue({
      platformCode: "perfectworld",
      configured: false,
      expired: false,
    });
    mocks.autoLinkPerfectWorld.mockResolvedValue({
      capabilities: ["season_ladder"],
    });
  });

  it("shows the Steam login name but never renders SteamID64", async () => {
    render(<AccountDrawer account={account} tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} notify={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText(account.steamId64)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("尚未关联第三方平台。")).toBeInTheDocument());
  });

  it("edits profile fields without a color control", () => {
    render(<AccountDrawer account={account} tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} notify={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    expect(screen.getByDisplayValue("主力")).toBeInTheDocument();
    expect(screen.queryByText("账号标识色")).not.toBeInTheDocument();
    expect(screen.queryByText("SteamID64")).not.toBeInTheDocument();
  });

  it("verifies a 5E player locator after saving an unverified link", async () => {
    const notify = vi.fn();
    render(<AccountDrawer account={account} tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} notify={notify} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    fireEvent.change(screen.getByLabelText("平台"), { target: { value: "5e" } });
    fireEvent.change(screen.getByLabelText(/5E 玩家名称、主页链接或 ID/), { target: { value: "已验证玩家" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并验证" }));

    await waitFor(() => expect(mocks.playerData).toHaveBeenCalledWith(expect.any(String), true));
    expect(mocks.saveLink).toHaveBeenCalledWith(
      expect.objectContaining({
        platformCode: "5e",
        externalId: "已验证玩家",
        status: "unverified",
      }),
    );
    expect(notify).toHaveBeenCalledWith("success", "5E 玩家已验证并关联");
  });

  it("allows a platform-only association without querying player data", async () => {
    render(<AccountDrawer account={account} tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} notify={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    fireEvent.click(screen.getByRole("button", { name: "添加关联" }));

    await waitFor(() =>
      expect(mocks.saveLink).toHaveBeenCalledWith(
        expect.objectContaining({
          platformCode: "perfectworld",
          externalId: undefined,
          status: "unverified",
        }),
      ),
    );
    expect(mocks.playerData).not.toHaveBeenCalled();
  });

  it("automatically matches Perfect World with the account SteamID when a token is configured", async () => {
    mocks.platformCredentialStatus.mockResolvedValue({
      platformCode: "perfectworld",
      configured: true,
      expired: false,
    });
    mocks.links
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "perfectworld-link",
        steamAccountId: account.id,
        platformCode: "perfectworld",
        externalId: account.steamId64,
        status: "user_confirmed",
      }]);

    render(<AccountDrawer account={account} tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} notify={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() =>
      expect(mocks.autoLinkPerfectWorld).toHaveBeenCalledWith(account.id),
    );
    expect(await screen.findByText("已使用 SteamID 自动匹配完美平台账号。")).toBeInTheDocument();
  });

  it("does not render a player query for a platform-only 5E link", async () => {
    mocks.links.mockResolvedValue([{
      id: "platform-only",
      steamAccountId: account.id,
      platformCode: "5e",
      status: "unverified",
    }]);
    render(<AccountDrawer account={account} tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} notify={vi.fn()} onChanged={vi.fn()} />);

    expect(
      await screen.findByText("仅平台关联，补充玩家信息后可查询战绩"),
    ).toBeInTheDocument();
    expect(screen.queryByText("5E 玩家数据")).not.toBeInTheDocument();
    expect(mocks.playerData).not.toHaveBeenCalled();
  });

  it("loads an existing association into the form and keeps its link ID", async () => {
    mocks.links.mockResolvedValue([{
      id: "existing-link",
      steamAccountId: account.id,
      platformCode: "5e",
      externalId: "old-player",
      displayName: "旧玩家",
      profileUrl: "https://arena.5eplay.com/data/player/old-player",
      remark: "旧备注",
      status: "user_confirmed",
    }]);
    render(<AccountDrawer account={account} tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} notify={vi.fn()} onChanged={vi.fn()} />);

    await screen.findByText("旧玩家");
    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 5E 关联" }));
    const locator = screen.getByLabelText(/5E 玩家名称、主页链接或 ID/);
    expect(locator).toHaveValue("old-player");
    fireEvent.change(locator, { target: { value: "new-player" } });
    fireEvent.change(screen.getByLabelText("备注（可选）"), { target: { value: "新备注" } });
    fireEvent.click(screen.getByRole("button", { name: "验证并保存修改" }));

    await waitFor(() =>
      expect(mocks.saveLink).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "existing-link",
          externalId: "new-player",
          remark: "新备注",
        }),
      ),
    );
  });

  it("cancels association edits without writing changes", async () => {
    mocks.links.mockResolvedValue([{
      id: "existing-link",
      steamAccountId: account.id,
      platformCode: "5e",
      externalId: "old-player",
      status: "user_confirmed",
    }]);
    render(<AccountDrawer account={account} tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} notify={vi.fn()} onChanged={vi.fn()} />);

    await screen.findByText("old-player");
    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 5E 关联" }));
    fireEvent.change(screen.getByLabelText(/5E 玩家名称、主页链接或 ID/), {
      target: { value: "unsaved-player" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));

    expect(screen.getByLabelText("平台账号（可选）")).toHaveValue("");
    expect(mocks.saveLink).not.toHaveBeenCalled();
  });
});
