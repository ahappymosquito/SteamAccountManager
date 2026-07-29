/** Static regression tests for desktop security configuration used by local avatar assets. */
// @vitest-environment node
// @ts-expect-error The production TypeScript graph intentionally omits Node types; Vitest provides this built-in at runtime.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type TauriConfig = {
  app: {
    security: {
      assetProtocol: {
        scope: string[];
      };
    };
  };
};

const config = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as TauriConfig;

describe("Tauri avatar asset scope", () => {
  it("allows only the application avatar cache under AppData", () => {
    expect(config.app.security.assetProtocol.scope).toEqual(["$APPDATA/avatars/**/*"]);
  });
});
