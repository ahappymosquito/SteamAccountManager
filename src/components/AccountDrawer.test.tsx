/** Drawer behavior coverage for identity privacy, edit mode and local profile fields. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../lib/types";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
vi.mock("../lib/api", () => ({ api: { links: vi.fn().mockResolvedValue([]), saveLink: vi.fn(), deleteLink: vi.fn() } }));
import { AccountDrawer } from "./AccountDrawer";

const account: Account = { id: "account-1", steamId64: "76561198000000001", accountName: "alpha", personaName: "玩家", alias: "主力", remark: "竞技账号", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", favorite: true, tags: ["竞技"], platformCodes: [] };
afterEach(cleanup);

describe("AccountDrawer", () => {
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
});
