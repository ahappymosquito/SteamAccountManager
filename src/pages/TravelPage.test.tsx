/** 外出资料页：导入导出与复制登录字段。 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  travelIdentities: vi.fn(),
  exportTravelPack: vi.fn(),
  importTravelPack: vi.fn(),
  exportCfgText: vi.fn(),
  ts3Identities: vi.fn(),
  rememberedTs3Id: vi.fn(),
  uploadTravelVault: vi.fn(),
  downloadTravelVault: vi.fn(),
  replaceTravelVault: vi.fn(),
  deployTravelCfgs: vi.fn(),
}));
const dialogMock = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));
const clipboardMock = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogMock);
vi.mock("@tauri-apps/plugin-clipboard-manager", () => clipboardMock);

import { TravelPage } from "./TravelPage";

const identity = {
  steamAccountId: "acc-1",
  steamId64: "76561198000000001",
  accountName: "alpha",
  personaName: "主力",
  localAvailable: false,
  fiveE: {
    displayName: "查询昵称",
    loginAccount: "five-login",
    loginPassword: "five-pass",
  },
  cfg: {
    name: "主力配置",
    fileName: "travel-00000001.cfg",
    content: "sensitivity 1.2\n",
  },
};

describe("TravelPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    apiMock.travelIdentities.mockResolvedValue([identity]);
    apiMock.ts3Identities.mockResolvedValue([]);
    apiMock.rememberedTs3Id.mockResolvedValue(null);
    clipboardMock.writeText.mockResolvedValue(undefined);
  });

  it("copies steam login and 5E password from a travel identity", async () => {
    const notify = vi.fn();
    render(<TravelPage notify={notify} />);
    await screen.findByText("仅资料，不可切号");
    fireEvent.click(screen.getByRole("button", { name: "复制Steam 登录名" }));
    await waitFor(() =>
      expect(clipboardMock.writeText).toHaveBeenCalledWith("alpha"),
    );
    fireEvent.click(screen.getByRole("button", { name: "复制5E密码" }));
    await waitFor(() =>
      expect(clipboardMock.writeText).toHaveBeenCalledWith("five-pass"),
    );
  });

  it("imports a travel pack and refreshes identities", async () => {
    const notify = vi.fn();
    dialogMock.open.mockResolvedValue("C:\\usb\\travel.json");
    apiMock.importTravelPack.mockResolvedValue({
      identityCount: 2,
      platformCount: 3,
      cfgCount: 2,
    });
    render(<TravelPage notify={notify} />);
    await screen.findByText("仅资料，不可切号");
    fireEvent.click(screen.getByRole("button", { name: "导入资料包" }));
    await waitFor(() =>
      expect(apiMock.importTravelPack).toHaveBeenCalledWith("C:\\usb\\travel.json"),
    );
    expect(notify).toHaveBeenCalledWith(
      "success",
      "已导入 2 个身份，未登录 Steam 的记录只出现在本页",
    );
  });

  it("replaces from a TeamSpeak id and copies the exec command when CS2 is not ready", async () => {
    const notify = vi.fn();
    apiMock.replaceTravelVault.mockResolvedValue({
      import: { identityCount: 1, platformCount: 1, cfgCount: 1 },
      deploy: {
        gameReady: false,
        written: [],
        execCommand: "exec travel-00000001.cfg",
        message:
          "CS2 还没有启动过（找不到 game\\csgo\\cfg）。先启动一次游戏，再在控制台输入：exec travel-00000001.cfg",
      },
    });
    render(<TravelPage notify={notify} />);
    await screen.findByText("仅资料，不可切号");
    fireEvent.change(screen.getByLabelText("TeamSpeak Unique ID"), {
      target: { value: "IHoxfrQNl152vs80N4wYvsEmNd8=" },
    });
    fireEvent.click(screen.getByRole("button", { name: "一键替代" }));
    await waitFor(() =>
      expect(apiMock.replaceTravelVault).toHaveBeenCalledWith(
        "IHoxfrQNl152vs80N4wYvsEmNd8=",
      ),
    );
    expect(await screen.findByText("exec travel-00000001.cfg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "复制控制台指令" }));
    await waitFor(() =>
      expect(clipboardMock.writeText).toHaveBeenCalledWith(
        "exec travel-00000001.cfg",
      ),
    );
  });
});
