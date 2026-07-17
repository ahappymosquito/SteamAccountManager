/** Account identity presentation tests for local avatar fallbacks and palette compatibility. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "./lib/types";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
import { Avatar } from "./App";

const account: Account = { id: "1", steamId64: "76561198000000001", accountName: "alpha", personaName: "玩家", alias: "主力", localAvailable: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", favorite: false, tags: [], platformCodes: [], avatarPath: "C:\\app\\avatars\\76561198000000001.png", color: "legacy-color" };

describe("Avatar", () => {
  it("falls back after a cached image load error", () => {
    const { container } = render(<Avatar account={account} />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByLabelText("头像加载失败")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("color-sky");
  });
});
