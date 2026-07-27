/** Update banner behavior for installed and portable application releases. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppUpdateBanner } from "./AppUpdateBanner";

const installedUpdate = {
  currentVersion: "0.4.3",
  version: "0.4.4",
  notes: "修复与改进",
  portable: false,
};

describe("AppUpdateBanner", () => {
  afterEach(cleanup);

  it("starts an installed update and supports deferring it", () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();
    render(
      <AppUpdateBanner
        update={installedUpdate}
        onInstall={onInstall}
        onDismiss={onDismiss}
        onDetails={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "更新并重启" }));
    fireEvent.click(screen.getByRole("button", { name: "稍后更新" }));
    expect(onInstall).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("explains portable conversion and locks actions while downloading", () => {
    render(
      <AppUpdateBanner
        update={{ ...installedUpdate, portable: true }}
        progress={{ state: "downloading", downloaded: 50, total: 100 }}
        onInstall={vi.fn()}
        onDismiss={vi.fn()}
        onDetails={vi.fn()}
      />,
    );

    expect(screen.getAllByText("正在下载 50%")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "正在下载 50%" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "稍后更新" })).toBeDisabled();
  });
});
