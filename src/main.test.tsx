/** Bootstrap regression tests for restoring every supported theme before React renders. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { themes } from "./lib/themes";

const render = vi.fn();
vi.mock("react-dom/client", () => ({
  default: { createRoot: () => ({ render }) },
}));
vi.mock("./App", () => ({ default: () => null }));

describe("theme bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    render.mockClear();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it.each(themes)("restores $value before rendering", async ({ value }) => {
    localStorage.setItem("sam-theme", value);
    await import("./main");
    expect(document.documentElement.dataset.theme).toBe(value);
    expect(render).toHaveBeenCalledOnce();
  });

  it("uses glacier without persisting when local storage is invalid", async () => {
    localStorage.setItem("sam-theme", "unknown");
    await import("./main");
    expect(document.documentElement.dataset.theme).toBe("glacier");
    expect(localStorage.getItem("sam-theme")).toBe("unknown");
  });
});
