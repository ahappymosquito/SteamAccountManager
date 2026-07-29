/** Account identity presentation tests for local avatar fallbacks. */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "./lib/types";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
import { AccountAvatar } from "./components/AccountAvatar";

const account: Account = { id: "1", steamId64: "76561198000000001", accountName: "alpha", personaName: "Player", alias: "Main", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", favorite: false, tags: [], platformCodes: [], avatarPath: "C:\\app\\avatars\\76561198000000001.png" };

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
