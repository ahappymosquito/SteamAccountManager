/** Regression tests for flushing the latest CFG draft before account switching. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveCfgProfile = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./lib/api", () => ({ api: { saveCfgProfile } }));

import { flushCfgDraft, useCfgWorkspace } from "./cfgWorkspace";

describe("CFG workspace draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCfgWorkspace.getState().load({
      id: "profile-1",
      name: "主配置",
      fileName: "autoexec.cfg",
      content: "fps_max 300",
      createdAt: "",
      updatedAt: "",
    });
  });

  it("flushes the newest editor content on demand", async () => {
    useCfgWorkspace.getState().edit({ content: "fps_max 500" });
    await flushCfgDraft();
    expect(saveCfgProfile).toHaveBeenCalledWith(
      "profile-1",
      "主配置",
      "fps_max 500",
    );
    expect(useCfgWorkspace.getState().isDirty()).toBe(false);
  });
});
