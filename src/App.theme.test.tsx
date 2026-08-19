/** Integration tests for application branding, theme changes, and asynchronous restoration. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mockBackend(
  settings: Promise<Record<string, unknown>>,
  update: Record<string, unknown> | null = null,
) {
  invoke.mockImplementation((command: string) => {
    if (command === "initialize_steam") {
      return Promise.resolve({
        steamPath: "C:\\Steam",
        scanPerformed: false,
        accountCount: 0,
        platformCount: 0,
      });
    }
    if (command === "get_settings") return settings;
    if (command === "list_accounts") return Promise.resolve([]);
    if (command === "current_status") {
      return Promise.resolve({ kind: "unknown", steamRunning: false });
    }
    if (command === "list_tags") return Promise.resolve([]);
    if (command === "set_setting") return Promise.resolve();
    if (command === "check_app_update") return Promise.resolve(update);
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  });
}

async function chooseTheme(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "切换主题" }));
  await user.click(await screen.findByText(name));
}

describe("App theme lifecycle", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    invoke.mockReset();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("applies and saves a theme selected from the title bar", async () => {
    const settings = deferred<Record<string, unknown>>();
    mockBackend(settings.promise);
    const { container } = render(<App />);

    expect(container.querySelector(".brand-logo")).toHaveAttribute(
      "src",
      "/app-icon.png",
    );

    await chooseTheme("薄荷白");

    expect(document.documentElement.dataset.theme).toBe("daylight");
    expect(localStorage.getItem("sam-theme")).toBe("daylight");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "切换主题" }));
    expect((await screen.findByText("薄荷白")).parentElement).toHaveTextContent(
      "当前",
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_setting", {
        key: "theme",
        value: "daylight",
      }),
    );
  });

  it("does not let a late database response overwrite a user selection", async () => {
    const settings = deferred<Record<string, unknown>>();
    mockBackend(settings.promise);
    render(<App />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_settings"));
    await chooseTheme("淡紫雾");
    settings.resolve({ theme: "violet" });

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("lilac"),
    );
    expect(localStorage.getItem("sam-theme")).toBe("lilac");
  });

  it("restores the database theme even when Steam initialization fails", async () => {
    mockBackend(Promise.resolve({ theme: "violet" }));
    invoke.mockImplementation((command: string) => {
      if (command === "initialize_steam") {
        return Promise.reject(new Error("Steam unavailable"));
      }
      if (command === "get_settings") {
        return Promise.resolve({ theme: "violet" });
      }
      if (command === "list_accounts") return Promise.resolve([]);
      if (command === "current_status") {
        return Promise.resolve({ kind: "unknown", steamRunning: false });
      }
      if (command === "list_tags") return Promise.resolve([]);
      return Promise.resolve();
    });

    render(<App />);

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("violet"),
    );
    expect(localStorage.getItem("sam-theme")).toBe("violet");
  });

  it("checks silently on startup and shows an update button in the sidebar", async () => {
    mockBackend(Promise.resolve({ theme: "glacier" }), {
      currentVersion: "0.4.3",
      version: "0.5.0",
      notes: "新增自动更新",
      portable: false,
    });
    render(<App />);

    expect(await screen.findByText("可更新至 v0.5.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeEnabled();
  });
});
