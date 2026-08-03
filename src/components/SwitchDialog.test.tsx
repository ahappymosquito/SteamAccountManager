/** Steam and linked-5E account switch confirmation behavior coverage. */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account, SwitchProgress } from "../lib/types";
import { SwitchDialog } from "./SwitchDialog";

const account: Account = {
  id: "account-1",
  steamId64: "76561198000000001",
  accountName: "alpha",
  personaName: "玩家",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  favorite: false,
  tags: [],
  platformCodes: ["5e"],
};

afterEach(cleanup);

describe("SwitchDialog", () => {
  it("announces linked 5E restart and shows the current persona name", () => {
    render(
      <SwitchDialog
        account={account}
        status={{
          kind: "locally_confirmed",
          accountName: "login_name",
          personaName: "当前中文昵称",
          steamRunning: true,
        }}
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/确认目标 Steam 账号登录后会启动或重启 5E/),
    ).toBeInTheDocument();
    expect(screen.getByText(/已安装 CS2 时会先同步所选 CFG/)).toBeInTheDocument();
    expect(screen.getByText("当前中文昵称")).toBeInTheDocument();
    expect(screen.queryByText("login_name")).not.toBeInTheDocument();
  });

  it("shows backend stages and keeps the dialog locked until switching completes", async () => {
    let finish: (() => void) | undefined;
    let report: ((progress: SwitchProgress) => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(async (onProgress: (progress: SwitchProgress) => void) => {
      report = onProgress;
      onProgress({
        stage: "waiting_steam_login",
        message: "正在等待目标 Steam 账号登录",
      });
      await pending;
    });

    render(
      <SwitchDialog
        account={account}
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "正在等待目标 Steam 账号登录",
    );
    expect(screen.getByRole("button", { name: "正在切换" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();

    act(() =>
      report?.({
        stage: "waiting_steam_services",
        message: "Steam 账号已登录，正在等待服务就绪",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Steam 账号已登录，正在等待服务就绪",
    );
    act(() =>
      report?.({
        stage: "starting_five_e",
        message: "Steam 已就绪，正在启动或重启 5E",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Steam 已就绪，正在启动或重启 5E",
    );

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => finish?.());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
