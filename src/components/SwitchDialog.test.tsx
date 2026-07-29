/** Steam and linked-5E account switch confirmation behavior coverage. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../lib/types";
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
      screen.getByText(/Steam 切换完成后会启动或重启 5E/),
    ).toBeInTheDocument();
    expect(screen.getByText(/已安装 CS2 时会先同步所选 CFG/)).toBeInTheDocument();
    expect(screen.getByText("当前中文昵称")).toBeInTheDocument();
    expect(screen.queryByText("login_name")).not.toBeInTheDocument();
  });
});
