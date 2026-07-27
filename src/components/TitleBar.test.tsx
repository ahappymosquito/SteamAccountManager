/** Regression tests for native window interactions exposed by the custom title bar. */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const windowApi = vi.hoisted(() => ({
  startDragging: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));

import { TitleBar } from "./TitleBar";

describe("TitleBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses one native drag call for the title, icon, and blank area", () => {
    const { container } = render(
      <TitleBar theme="glacier" onThemeChange={vi.fn()} />,
    );
    expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
    expect(container.querySelector(".window-title img")).toHaveAttribute(
      "src",
      "/app-icon.png",
    );

    fireEvent.mouseDown(screen.getByText("Steam Account Manager"), {
      button: 0,
    });
    fireEvent.mouseDown(container.querySelector(".window-title img")!, {
      button: 0,
    });
    fireEvent.mouseDown(container.querySelector(".window-drag-space")!, {
      button: 0,
    });
    expect(windowApi.startDragging).toHaveBeenCalledTimes(3);
  });

  it("scopes native dragging to explicit drag surfaces", () => {
    const { container } = render(
      <TitleBar theme="glacier" onThemeChange={vi.fn()} />,
    );
    fireEvent.mouseDown(container.querySelector(".window-titlebar")!, {
      button: 0,
    });
    for (const button of container.querySelectorAll("button")) {
      fireEvent.mouseDown(button, { button: 0 });
    }
    expect(windowApi.startDragging).not.toHaveBeenCalled();
  });
});
