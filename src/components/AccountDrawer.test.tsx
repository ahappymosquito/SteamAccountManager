/** Drawer regression coverage for direct platform editing and plaintext credentials. */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, PlatformLink } from "../lib/types";

const mocks = vi.hoisted(() => ({
  links: vi.fn(),
  saveLink: vi.fn(),
  deleteLink: vi.fn(),
  playerData: vi.fn(),
  platformCredentialStatus: vi.fn(),
  autoLinkPerfectWorld: vi.fn(),
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
  platformCodes: [],
};

const existingFiveE: PlatformLink = {
  id: "existing-link",
  steamAccountId: account.id,
  platformCode: "5e",
  externalId: "旧玩家",
  displayName: "旧玩家",
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
    mocks.links.mockResolvedValue([]);
    mocks.saveLink.mockResolvedValue(undefined);
    mocks.deleteLink.mockResolvedValue(undefined);
    mocks.writeText.mockResolvedValue(undefined);
    mocks.playerData.mockResolvedValue({
      platform: "5e",
      externalId: "已验证玩家",
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

  it("shows fixed pending platform rows without exposing SteamID64", async () => {
    renderDrawer();

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText(account.steamId64)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "填写完美平台资料" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "填写5E资料" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(mocks.links).toHaveBeenCalledWith(account.id));
  });

  it("edits account profile fields independently from platform editing", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));

    expect(screen.getByDisplayValue("主力")).toBeInTheDocument();
    expect(screen.queryByText("账号标识色")).not.toBeInTheDocument();
    expect(screen.queryByText("SteamID64")).not.toBeInTheDocument();
  });

  it("opens 5E directly, saves credentials, and queries by platform nickname", async () => {
    const notify = vi.fn();
    renderDrawer({ initialPlatform: "5e", notify });

    const nickname = await screen.findByLabelText("平台昵称");
    fireEvent.change(nickname, { target: { value: "已验证玩家" } });
    fireEvent.change(screen.getByLabelText("登录账号"), {
      target: { value: "five-login" },
    });
    fireEvent.change(screen.getByLabelText("登录密码"), {
      target: { value: "plain-password" },
    });
    fireEvent.change(screen.getByLabelText("备注"), {
      target: { value: "短信验证后登录" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并查询" }));

    await waitFor(() =>
      expect(mocks.playerData).toHaveBeenCalledWith(expect.any(String), true),
    );
    expect(mocks.saveLink).toHaveBeenCalledWith(
      expect.objectContaining({
        platformCode: "5e",
        externalId: "已验证玩家",
        displayName: "已验证玩家",
        loginAccount: "five-login",
        loginPassword: "plain-password",
        remark: "短信验证后登录",
      }),
    );
    expect(notify).toHaveBeenCalledWith("success", "5E 玩家已验证并关联");
  });

  it("stores a Perfect World profile against the account SteamID", async () => {
    renderDrawer({ initialPlatform: "perfectworld" });

    await screen.findByLabelText("平台昵称");
    fireEvent.change(screen.getByLabelText("平台昵称"), {
      target: { value: "完美昵称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存平台资料" }));

    await waitFor(() =>
      expect(mocks.saveLink).toHaveBeenCalledWith(
        expect.objectContaining({
          platformCode: "perfectworld",
          externalId: account.steamId64,
          displayName: "完美昵称",
        }),
      ),
    );
    expect(mocks.playerData).not.toHaveBeenCalledWith(expect.anything(), true);
  });

  it("masks, reveals, and copies stored platform credentials", async () => {
    mocks.links.mockResolvedValue([existingFiveE]);
    renderDrawer();

    expect(await screen.findByText("***")).toBeInTheDocument();
    expect(screen.queryByText("plain-password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(screen.getByText("plain-password")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "复制5E登录密码" }),
    );

    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith("plain-password"),
    );
  });

  it("loads an existing platform link and preserves its ID when edited", async () => {
    mocks.links.mockResolvedValue([existingFiveE]);
    renderDrawer({ initialPlatform: "5e" });

    const nickname = await screen.findByLabelText("平台昵称");
    expect(nickname).toHaveValue("旧玩家");
    fireEvent.change(nickname, { target: { value: "新玩家" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并查询" }));

    await waitFor(() =>
      expect(mocks.saveLink).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "existing-link",
          externalId: "新玩家",
        }),
      ),
    );
  });

  it("automatically matches Perfect World by SteamID when Token is configured", async () => {
    mocks.platformCredentialStatus.mockResolvedValue({
      platformCode: "perfectworld",
      configured: true,
      expired: false,
    });
    mocks.links
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "perfectworld-link",
          steamAccountId: account.id,
          platformCode: "perfectworld",
          externalId: account.steamId64,
          status: "user_confirmed",
        },
      ]);
    renderDrawer();

    await waitFor(() =>
      expect(mocks.autoLinkPerfectWorld).toHaveBeenCalledWith(account.id),
    );
    expect(
      await screen.findByText("已使用 SteamID 自动匹配完美平台账号。"),
    ).toBeInTheDocument();
  });

  it("cancels targeted platform editing without writing changes", async () => {
    mocks.links.mockResolvedValue([existingFiveE]);
    renderDrawer({ initialPlatform: "5e" });

    const nickname = await screen.findByLabelText("平台昵称");
    fireEvent.change(nickname, { target: { value: "未保存玩家" } });
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));

    expect(screen.queryByLabelText("平台昵称")).not.toBeInTheDocument();
    expect(mocks.saveLink).not.toHaveBeenCalled();
  });
});
