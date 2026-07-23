/** Regression tests for native window interactions exposed by the custom title bar. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  it("starts native dragging from the title area", () => {
    render(<TitleBar theme="glacier" onThemeChange={vi.fn()} />);
    fireEvent.mouseDown(screen.getByText("Steam Account Manager"), {
      button: 0,
    });
    expect(windowApi.startDragging).toHaveBeenCalledOnce();
  });
});
