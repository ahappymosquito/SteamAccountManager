/** Static accessibility and responsive contract checks for the four theme styles. */
// @vitest-environment node
// @ts-expect-error The production TypeScript graph intentionally omits Node types; Vitest provides this built-in at runtime.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("theme and layout contracts", () => {
  it("defines all themes with focus visibility", () => {
    for (const theme of ["aurora", "violet", "mint", "glacier"]) expect(css).toContain(`data-theme="${theme}"`);
    expect(css).toContain(":focus-visible");
  });

  it("covers target desktop widths, high scaling and reduced motion", () => {
    expect(css).toContain("@media(max-width:1180px)");
    expect(css).toContain("@media(max-width:820px)");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(css).toContain("scroll-behavior:auto!important");
  });

  it("keeps dropdown portals above dialogs", () => {
    expect(css).toMatch(/\.dialog\{[^}]*z-index:70/);
    expect(css).toMatch(/\.tag-menu\{[^}]*z-index:90/);
  });
});
