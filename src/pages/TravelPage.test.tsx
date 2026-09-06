/** 外出资料页：短名字+口令打开云存档，并复制登录字段。 */
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
  rememberedVaultName: vi.fn(),
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
  localAvailable: true,
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
    apiMock.rememberedVaultName.mockResolvedValue(null);
    clipboardMock.writeText.mockResolvedValue(undefined);
  });

  it("copies steam login and 5E password from a travel identity", async () => {
    const notify = vi.fn();
    render(<TravelPage notify={notify} />);
    await screen.findByText("主力");
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
    await screen.findByText("主力");
    fireEvent.click(screen.getByRole("button", { name: "导入 U 盘" }));
    await waitFor(() =>
      expect(apiMock.importTravelPack).toHaveBeenCalledWith("C:\\usb\\travel.json"),
    );
    expect(notify).toHaveBeenCalledWith("success", "已导入 2 个身份");
  });

  it("shows the import error when the pack cannot be read", async () => {
    const notify = vi.fn();
    dialogMock.open.mockResolvedValue("C:\\usb\\broken.json");
    apiMock.importTravelPack.mockRejectedValue({
      code: "TRAVEL_PACK_INVALID",
      message: "请选择 Steam Account Manager 外出资料包",
    });
    render(<TravelPage notify={notify} />);
    await screen.findByText("主力");
    fireEvent.click(screen.getByRole("button", { name: "导入 U 盘" }));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "error",
        "请选择 Steam Account Manager 外出资料包",
      ),
    );
  });

  it("opens a named vault into this session without listing leftover local records", async () => {
    const notify = vi.fn();
    apiMock.travelIdentities.mockResolvedValue([
      { ...identity, personaName: "残留", localAvailable: false },
    ]);
    apiMock.replaceTravelVault.mockResolvedValue({
      identities: [{ ...identity, localAvailable: false }],
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
    await screen.findByRole("button", { name: "打开" });
    expect(screen.queryByText("残留")).toBeNull();
    fireEvent.change(screen.getByLabelText("名字"), {
      target: { value: "小明" },
    });
    fireEvent.change(screen.getByLabelText("口令"), {
      target: { value: "2468" },
    });
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await waitFor(() =>
      expect(apiMock.replaceTravelVault).toHaveBeenCalledWith("小明", "2468"),
    );
    expect(await screen.findByText("主力")).toBeTruthy();
    expect(await screen.findByText("exec travel-00000001.cfg")).toBeTruthy();
    expect(apiMock.travelIdentities).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "复制控制台指令" }));
    await waitFor(() =>
      expect(clipboardMock.writeText).toHaveBeenCalledWith(
        "exec travel-00000001.cfg",
      ),
    );
  });

  it("does not open a vault with only a name", async () => {
    const notify = vi.fn();
    render(<TravelPage notify={notify} />);
    await screen.findByText("主力");
    fireEvent.change(screen.getByLabelText("名字"), {
      target: { value: "小明" },
    });
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("error", "请填写口令"),
    );
    expect(apiMock.replaceTravelVault).not.toHaveBeenCalled();
  });
});
