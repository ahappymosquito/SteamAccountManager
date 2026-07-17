/** Profile form schema coverage for safe identifiers and the fixed color palette. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../lib/types";
import { ProfileDialog, profileSchema } from "./ProfileDialog";

const account: Account = { id: "1", steamId64: "76561198000000001", accountName: "alpha", personaName: "玩家", localAvailable: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", favorite: false, tags: ["主力"], platformCodes: [] };
afterEach(cleanup);

describe("profileSchema", () => {
  it("rejects malformed SteamID64", () => {
    expect(profileSchema.safeParse({ steamId64: "123", alias: "", remark: "", color: "sky", favorite: false }).success).toBe(false);
  });

  it("accepts non-sensitive profile data", () => {
    expect(profileSchema.safeParse({ steamId64: "76561198000000001", alias: "主力", remark: "", color: "cyan", favorite: true }).success).toBe(true);
  });

  it("rejects arbitrary legacy colors", () => {
    expect(profileSchema.safeParse({ steamId64: "76561198000000001", alias: "", remark: "", color: "#ff00ff", favorite: false }).success).toBe(false);
  });

  it("keeps an existing Steam ID in a collapsed read-only advanced section", () => {
    render(<ProfileDialog account={account} tagOptions={[{ name: "竞技", usageCount: 2 }]} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    const input = screen.getByDisplayValue(account.steamId64);
    expect(input).toHaveAttribute("readonly");
    expect(screen.getByText("高级信息").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "历史标签" })).toBeInTheDocument();
  });

  it("opens advanced identity for manual profiles", () => {
    render(<ProfileDialog tagOptions={[]} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText("高级信息").closest("details")).toHaveAttribute("open");
  });
});
