/** 校验安装版 NSIS 钩子会检测 WebView2 并从 CDN 安装，且便携版不绑定这段逻辑。 */
import { describe, expect, it } from "vitest";
import tauriConfig from "../src-tauri/tauri.conf.json";
import hooks from "../src-tauri/windows/installer-hooks.nsh?raw";
import main from "../src-tauri/src/main.rs?raw";

describe("WebView2 installer hook", () => {
  it("skips Tauri's Microsoft bootstrapper so the NSIS hook owns Runtime install", () => {
    expect(tauriConfig.bundle.windows.webviewInstallMode).toEqual({
      type: "skip",
    });
  });

  it("detects Runtime, prompts in Chinese, and downloads the CDN standalone installer", () => {
    expect(hooks).toContain("NSIS_HOOK_PREINSTALL");
    expect(hooks).toContain(
      "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2APPGUID}",
    );
    expect(hooks).toContain(
      "https://cdn.qrqto.club/webview2/MicrosoftEdgeWebView2RuntimeInstallerX64.exe",
    );
    expect(hooks).toContain("是否现在从 CDN 下载并安装");
    expect(hooks).toContain('Abort "没有 WebView2 Runtime，无法继续安装。"');
    expect(hooks).toContain("Invoke-WebRequest");
    expect(hooks).toContain('ExecWait \'"$6" /install\'');
  });

  it("does not add a portable-exe startup check in main.rs", () => {
    expect(main).not.toMatch(/webview2/i);
    expect(main).toContain("steam_account_manager_lib::run()");
  });
});
