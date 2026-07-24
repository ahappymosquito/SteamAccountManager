/** Regression tests for deterministic theme restoration and persistence. */
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, resolveTheme, savedTheme, themes } from "./themes";

describe("resolveTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("keeps a valid locally selected theme over the database value", () => {
    expect(resolveTheme("mint", "glacier")).toBe("mint");
  });

  it("falls back to a valid database theme and then the default", () => {
    expect(resolveTheme(undefined, "violet")).toBe("violet");
    expect(resolveTheme(undefined, "invalid")).toBe("glacier");
  });

  it.each(themes)("restores $value from local storage", ({ value }) => {
    localStorage.setItem("sam-theme", value);
    expect(savedTheme()).toBe(value);
  });

  it("ignores an invalid locally stored theme", () => {
    localStorage.setItem("sam-theme", "unknown");
    expect(savedTheme()).toBe("glacier");
  });

  it("applies and persists all six available themes immediately", () => {
    expect(themes).toHaveLength(6);
    for (const theme of themes) {
      applyTheme(theme.value);
      expect(document.documentElement.dataset.theme).toBe(theme.value);
      expect(localStorage.getItem("sam-theme")).toBe(theme.value);
    }
  });
});
