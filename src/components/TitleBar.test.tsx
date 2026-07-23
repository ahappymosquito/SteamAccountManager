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

  it("does not drag when a title-bar control is pressed", () => {
    const { container } = render(
      <TitleBar theme="glacier" onThemeChange={vi.fn()} />,
    );
    for (const button of container.querySelectorAll("button")) {
      fireEvent.mouseDown(button, { button: 0 });
    }
    expect(windowApi.startDragging).not.toHaveBeenCalled();
  });
});
