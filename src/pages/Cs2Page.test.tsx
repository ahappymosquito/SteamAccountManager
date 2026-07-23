/** UI regressions for the collapsed CFG tools and read-only runtime preview. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const profile = {
  id: "cfg-1",
  name: "主配置",
  fileName: "autoexec.cfg",
  content: "fps_max 300",
  createdAt: "",
  updatedAt: "",
};
const apiMock = vi.hoisted(() => ({
  activeCfgProfile: vi.fn(),
  cfgProfiles: vi.fn(),
  cfgVersions: vi.fn(),
  cs2RuntimeFiles: vi.fn(),
  previewCs2RuntimeFile: vi.fn(),
  saveCfgProfile: vi.fn(),
}));
vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { Cs2Page } from "./Cs2Page";

describe("Cs2Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.activeCfgProfile.mockResolvedValue(profile);
    apiMock.cfgProfiles.mockResolvedValue([profile]);
    apiMock.cfgVersions.mockResolvedValue([]);
    apiMock.cs2RuntimeFiles.mockResolvedValue([
      {
        steamId64: "76561198000000001",
        path: "C:\\runtime.cfg",
        name: "runtime.cfg",
        size: 20,
        editable: true,
      },
    ]);
    apiMock.previewCs2RuntimeFile.mockResolvedValue("volume 0.5");
    apiMock.saveCfgProfile.mockResolvedValue(undefined);
  });

  it("keeps auxiliary tools collapsed and opens runtime files read-only", async () => {
    const { container } = render(<Cs2Page notify={vi.fn()} />);
    await screen.findByDisplayValue("主配置");
    expect(container.querySelector("details.cfg-tools")).not.toHaveAttribute(
      "open",
    );

    fireEvent.click(screen.getByRole("button", { name: "运行文件" }));
    fireEvent.click(await screen.findByRole("button", { name: /runtime.cfg/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("运行文件只读预览")).toHaveAttribute(
        "readonly",
      ),
    );
    expect(screen.getByDisplayValue("volume 0.5")).toBeInTheDocument();
  });
});
