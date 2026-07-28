/** Steam-only account switch confirmation behavior coverage. */
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
  it("states that switching restarts only Steam", () => {
    render(
      <SwitchDialog
        account={account}
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        /不会自动启动 CS2 或任何关联平台/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/已安装 CS2 时会先同步所选 CFG/)).toBeInTheDocument();
  });
});
