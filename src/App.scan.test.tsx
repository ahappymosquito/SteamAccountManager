/** Integration tests for account scan coordination, progress feedback, and order persistence. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "./lib/types";

const invoke = vi.hoisted(() => vi.fn());
const windowApi = vi.hoisted(() => ({
  startDragging: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (value: unknown) => void;
  },
  invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0.11.8"),
}));

import App from "./App";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const accounts: Account[] = [
  {
    id: "1",
    steamId64: "76561198000000001",
    accountName: "alpha",
    personaName: "Player One",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    favorite: false,
    tags: [],
    platformCodes: [],
  },
  {
    id: "2",
    steamId64: "76561198000000002",
    accountName: "beta",
    personaName: "Player Two",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    favorite: false,
    tags: [],
    platformCodes: [],
  },
];

const startupResult = {
  steamPath: "C:\\Steam",
  scanPerformed: true,
  accountCount: accounts.length,
  platformCount: 0,
};

describe("account scanning", () => {
  let initialize: Deferred<typeof startupResult> | undefined;
  let manualScan: Deferred<number> | undefined;

  beforeEach(() => {
    initialize = undefined;
    manualScan = undefined;
    invoke.mockReset();
    localStorage.clear();
    invoke.mockImplementation((command: string) => {
      if (command === "initialize_steam") {
        return initialize?.promise ?? Promise.resolve(startupResult);
      }
      if (command === "scan_accounts") {
        return manualScan?.promise ?? Promise.resolve(accounts.length);
      }
      if (command === "refresh_steam_profile_media") return Promise.resolve(0);
      if (command === "list_accounts") return Promise.resolve(accounts);
      if (command === "current_status") {
        return Promise.resolve({ kind: "unknown", steamRunning: false });
      }
      if (command === "list_tags") return Promise.resolve([]);
      if (command === "get_settings") return Promise.resolve({});
      if (command === "check_app_update") return Promise.resolve(null);
      if (command === "set_setting") return Promise.resolve();
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
  });

  afterEach(() => cleanup());

  it("shows cached accounts while startup scanning remains in progress", async () => {
    initialize = deferred<typeof startupResult>();
    const { container } = render(<App />);

    expect(await screen.findByText("Player One")).toBeInTheDocument();
    const scanButton = container.querySelector<HTMLButtonElement>(
      ".toolbar .button.primary",
    )!;
    expect(scanButton).toBeEnabled();
    fireEvent.click(screen.getAllByRole("button", { name: /切换账号/ })[0]);

    initialize.resolve(startupResult);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("refresh_steam_profile_media", {
        force: false,
      }),
    );
    expect(scanButton).toBeEnabled();
  });

  it("coalesces repeated manual scan clicks into one scan and one media refresh", async () => {
    const { container } = render(<App />);
    const scanButton = container.querySelector<HTMLButtonElement>(
      ".toolbar .button.primary",
    )!;
    await waitFor(() => expect(scanButton).toBeEnabled());
    invoke.mockClear();
    manualScan = deferred<number>();

    fireEvent.click(scanButton);
    fireEvent.click(scanButton);

    expect(invoke.mock.calls.filter(([command]) => command === "scan_accounts")).toHaveLength(1);
    expect(scanButton).toBeDisabled();
    manualScan.resolve(accounts.length);

    await waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === "refresh_steam_profile_media",
        ),
      ).toHaveLength(1),
    );
    await waitFor(() => expect(scanButton).toBeEnabled());
  });

  it("persists a clean-list pointer reorder exactly once", async () => {
    const { container } = render(<App />);
    await waitFor(() =>
      expect(
        container.querySelector<HTMLButtonElement>(".toolbar .button.primary"),
      ).toBeEnabled(),
    );
    invoke.mockClear();

    const handles = container.querySelectorAll<HTMLButtonElement>(
      ".account-drag-handle",
    );
    const rows = container.querySelectorAll<HTMLElement>(".account-row");
    fireEvent.pointerDown(handles[0], { button: 0, buttons: 1 });
    fireEvent.pointerEnter(rows[1], { buttons: 1 });
    fireEvent.pointerUp(document);

    await waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command, payload]) =>
            command === "set_setting" &&
            payload?.key === "account_order",
        ),
      ).toHaveLength(1),
    );
    expect(invoke).toHaveBeenCalledWith("set_setting", {
      key: "account_order",
      value: [accounts[1].steamId64, accounts[0].steamId64],
    });
  });

  it("persists the steam-only switch from the account toolbar", async () => {
    render(<App />);
    const toggle = await screen.findByRole("button", { name: "只切 Steam" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("不保存密码、Cookie、Token 或 Steam Guard 密钥")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(await screen.findByRole("button", { name: "只切 Steam" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_setting", {
        key: "steam_only_switch",
        value: false,
      }),
    );
  });
});
