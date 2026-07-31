/** Independent platform editor coverage for plaintext credentials and player queries. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: mocks.writeText,
}));
vi.mock("../lib/api", () => ({ api: mocks }));

import { PlatformAccountDialog } from "./PlatformAccountDialog";

const account: Account = {
  id: "account-1",
  steamId64: "76561198000000001",
  personaName: "玩家",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  favorite: false,
  tags: [],
  platformCodes: [],
};

const existing: PlatformLink = {
  id: "existing-fivee",
  steamAccountId: account.id,
  platformCode: "5e",
  externalId: "旧玩家",
  displayName: "旧玩家",
  loginAccount: "login",
  loginPassword: "password",
  status: "user_confirmed",
};

const renderDialog = (
  platform: "5e" | "perfectworld",
  props: Partial<React.ComponentProps<typeof PlatformAccountDialog>> = {},
) =>
  render(
    <PlatformAccountDialog
      account={account}
      platform={platform}
      open
      onOpenChange={vi.fn()}
      notify={vi.fn()}
      onChanged={vi.fn()}
      {...props}
    />,
  );

afterEach(cleanup);

describe("PlatformAccountDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.links.mockResolvedValue([]);
    mocks.saveLink.mockResolvedValue(undefined);
    mocks.deleteLink.mockResolvedValue(undefined);
    mocks.playerData.mockResolvedValue({});
    mocks.platformCredentialStatus.mockResolvedValue({
      platformCode: "perfectworld",
      configured: false,
      expired: false,
    });
    mocks.autoLinkPerfectWorld.mockResolvedValue({});
    mocks.writeText.mockResolvedValue(undefined);
    vi.stubGlobal("crypto", { randomUUID: () => "new-link" });
  });

  it("saves and queries 5E by its platform username", async () => {
    renderDialog("5e");
    fireEvent.change(await screen.findByLabelText("平台用户名"), {
      target: { value: "观注永雏塔菲喵" },
    });
    fireEvent.change(screen.getByLabelText("登录账号"), {
      target: { value: "five-login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并查询" }));
    await waitFor(() =>
      expect(mocks.saveLink).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "new-link",
          externalId: "观注永雏塔菲喵",
          displayName: "观注永雏塔菲喵",
          loginAccount: "five-login",
        }),
      ),
    );
    expect(mocks.playerData).toHaveBeenCalledWith("new-link", true);
  });

  it("closes after the profile is saved even when the player query fails", async () => {
    const onOpenChange = vi.fn();
    mocks.playerData.mockRejectedValue(new Error("玩家不存在"));
    renderDialog("5e", { onOpenChange });
    fireEvent.change(await screen.findByLabelText("平台用户名"), {
      target: { value: "可能输错的用户名" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并查询" }));

    await waitFor(() => expect(mocks.saveLink).toHaveBeenCalled());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.saveLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "invalid" }),
    );
  });

  it("closes after a database save failure instead of trapping the user", async () => {
    const onOpenChange = vi.fn();
    mocks.saveLink.mockRejectedValueOnce(new Error("写入失败"));
    renderDialog("5e", { onOpenChange });
    fireEvent.change(await screen.findByLabelText("平台用户名"), {
      target: { value: "玩家" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并查询" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("preserves an existing link ID and supports password reveal and copy", async () => {
    mocks.links.mockResolvedValue([existing]);
    renderDialog("5e");
    expect(await screen.findByDisplayValue("旧玩家")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(screen.getByDisplayValue("password")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "复制登录密码" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("password"));
  });

  it("stores Perfect World against SteamID and leaves querying optional", async () => {
    renderDialog("perfectworld");
    fireEvent.change(await screen.findByLabelText("平台用户名"), {
      target: { value: "完美玩家" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存平台资料" }));
    await waitFor(() =>
      expect(mocks.saveLink).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: account.steamId64 }),
      ),
    );
    expect(mocks.autoLinkPerfectWorld).not.toHaveBeenCalled();
  });
});
