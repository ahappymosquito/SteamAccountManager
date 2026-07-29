/** Regression tests for the allowlisted external URLs exposed by the desktop app. */
import { describe, expect, it } from "vitest";
import capability from "../src-tauri/capabilities/default.json";

const urlPatterns = capability.permissions.flatMap((permission) => {
  if (
    typeof permission === "string" ||
    permission.identifier !== "opener:allow-open-url"
  ) {
    return [];
  }
  return permission.allow.map(({ url }) => url);
});

const matchesAllowedUrl = (url: string) =>
  urlPatterns.some((pattern) => {
    const expression = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return new RegExp(`^${expression}$`).test(url);
  });

describe("external URL capability", () => {
  it.each([
    "https://github.com/ahappymosquito/SteamAccountManager",
    "https://github.com/ahappymosquito/SteamAccountManager/releases",
    "https://developer.valvesoftware.com/wiki/Bind",
    "https://csgo.5eplay.com/",
    "https://pvp.wanmei.com/",
  ])("allows the bundled official link %s", (url) => {
    expect(matchesAllowedUrl(url)).toBe(true);
  });

  it("does not allow unrelated web origins", () => {
    expect(matchesAllowedUrl("https://example.com/SteamAccountManager")).toBe(
      false,
    );
  });
});
