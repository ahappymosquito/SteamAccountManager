/** Account identity presentation tests for local avatar fallbacks. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "./lib/types";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
import { AccountAvatar } from "./components/AccountAvatar";
import { ACCOUNT_REFRESH_INTERVAL_MS, AccountsPage } from "./App";

const account: Account = { id: "1", steamId64: "76561198000000001", accountName: "alpha", personaName: "Player", alias: "Main", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", favorite: false, tags: [], platformCodes: [], avatarPath: "C:\\app\\avatars\\76561198000000001.png" };

it("refreshes the account page on a ten-second cadence", () => {
  expect(ACCOUNT_REFRESH_INTERVAL_MS).toBe(10_000);
});

describe("AccountAvatar", () => {
  it("shows the account initial when no cached image is available", () => {
    const { container } = render(<AccountAvatar account={{ ...account, avatarPath: undefined }} />);
    expect(container).toHaveTextContent("P");
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("uses the visible alias initial when no persona name is available", () => {
    const { container } = render(
      <AccountAvatar
        account={{
          ...account,
          personaName: undefined,
          accountName: undefined,
          alias: "Backup",
          avatarPath: undefined,
        }}
      />,
    );
    expect(container).toHaveTextContent("B");
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("falls back after a cached image load error", () => {
    const { container } = render(<AccountAvatar account={account} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container).toHaveTextContent("P");
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("neutral");
  });

  it("retries the same cached path after the account is refreshed", () => {
    const { container, rerender } = render(<AccountAvatar account={account} />);
    fireEvent.error(container.querySelector("img")!);

    rerender(<AccountAvatar account={{ ...account, updatedAt: "2026-01-02T00:00:00Z" }} />);

    expect(container.querySelector("img")).toHaveAttribute("src", `asset://${account.avatarPath}`);
    expect(container).not.toHaveTextContent("P");
  });
});

describe("AccountsPage ranking controls", () => {
  const ui = {
    page: "accounts" as const,
    query: "",
    favoriteOnly: false,
    platform: "5e" as const,
    accountSort: "score_asc" as const,
    selectedTags: [],
    notice: null,
    setPage: vi.fn(),
    setQuery: vi.fn(),
    setFavoriteOnly: vi.fn(),
    setPlatform: vi.fn(),
    setAccountSort: vi.fn(),
    setSelectedTags: vi.fn(),
    select: vi.fn(),
    notify: vi.fn(),
  };
  const props = {
    accounts: [],
    tagOptions: [],
    loading: false,
    scanning: false,
    ui,
    onScan: vi.fn(),
    onAdd: vi.fn(),
    onDetails: vi.fn(),
    onPlatform: vi.fn(),
    onReorder: vi.fn(),
    steamOnlySwitch: true,
    onSteamOnlySwitch: vi.fn(),
    onSwitch: vi.fn(),
    onFavorite: vi.fn(),
    onDelete: vi.fn(),
  };

  it("shows score sorting only while the 5E filter is active", () => {
    const { rerender } = render(<AccountsPage {...props} />);

    expect(screen.getByRole("combobox", { name: "5E 账号排序" }))
      .toHaveValue("score_asc");

    rerender(
      <AccountsPage
        {...props}
        ui={{ ...ui, platform: "", accountSort: "custom" }}
      />,
    );
    expect(screen.queryByRole("combobox", { name: "5E 账号排序" }))
      .not.toBeInTheDocument();
  });

  it("renders the cached Steam avatar frame above the avatar", () => {
    const framed = {
      ...account,
      avatarFramePath: "C:\\app\\avatars\\76561198000000001.frame.png",
    };
    const { container } = render(<AccountAvatar account={framed} />);

    expect(container.querySelector(".avatar-frame")).toHaveAttribute(
      "src",
      `asset://${framed.avatarFramePath}`,
    );
  });

  it("cache-busts a replaced avatar frame without changing its file path", () => {
    const framed = {
      ...account,
      avatarFramePath: "C:\\app\\avatars\\76561198000000001.frame.png",
      avatarFrameVersion: "123-456",
    };
    const { container } = render(<AccountAvatar account={framed} />);

    expect(container.querySelector(".avatar-frame")).toHaveAttribute(
      "src",
      `asset://${framed.avatarFramePath}?v=123-456`,
    );
  });

  it("enables keyboard reordering only for the clean custom list", () => {
    const onReorder = vi.fn();
    const second = {
      ...account,
      id: "2",
      steamId64: "76561198000000002",
      personaName: "Second",
    };
    render(
      <AccountsPage
        {...props}
        accounts={[account, second]}
        ui={{ ...ui, platform: "", accountSort: "custom" }}
        onReorder={onReorder}
      />,
    );

    const handle = screen.getByRole("button", {
      name: "调整 Player 的顺序",
    });
    expect(handle).toBeEnabled();
    expect(handle).not.toHaveAttribute("draggable");
    expect(handle.closest("article")).not.toHaveAttribute("draggable", "true");
    const secondRow = screen.getByText("Second").closest("article")!;
    fireEvent.pointerDown(handle, { button: 0, buttons: 1 });
    fireEvent.pointerEnter(secondRow, { buttons: 1 });
    fireEvent.pointerUp(document);
    expect(onReorder).toHaveBeenCalledWith(
      account.steamId64,
      second.steamId64,
    );
    onReorder.mockClear();
    fireEvent.keyDown(handle, { key: "ArrowDown", altKey: true });
    expect(onReorder).toHaveBeenCalledWith(
      account.steamId64,
      second.steamId64,
    );
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
  });
});
