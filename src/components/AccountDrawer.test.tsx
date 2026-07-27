/** Drawer behavior coverage for identity privacy, edit mode and local profile fields. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../lib/types";

const mocks = vi.hoisted(() => ({
  links: vi.fn(),
  saveLink: vi.fn(),
  deleteLink: vi.fn(),
  playerData: vi.fn(),
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

  it("verifies a 5E home ID and confirms the saved platform link", async () => {
    const notify = vi.fn();
    render(<AccountDrawer account={account} tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} notify={notify} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    fireEvent.change(screen.getByLabelText("平台"), { target: { value: "5e" } });
    fireEvent.change(screen.getByLabelText("5E 主页 ID"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并验证" }));

    await waitFor(() => expect(mocks.playerData).toHaveBeenCalledWith(expect.any(String), true));
    await waitFor(() =>
      expect(mocks.saveLink).toHaveBeenLastCalledWith(
        expect.objectContaining({
          platformCode: "5e",
          externalId: "123456",
          displayName: "已验证玩家",
          status: "user_confirmed",
        }),
      ),
    );
    expect(notify).toHaveBeenCalledWith("success", "5E 玩家已验证并关联");
  });
});
