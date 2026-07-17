/** Official Steam login waiting surface coverage. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SteamLoginDialog } from "./SteamLoginDialog";

describe("SteamLoginDialog", () => {
  it("explains automatic detection and allows cancellation", () => {
    const cancel = vi.fn();
    render(<SteamLoginDialog open session={{ id: "session", startedAt: "2026-01-01" }} onCancel={cancel}/>);
    expect(screen.getByText("检测成功后，账号列表会自动刷新。应用不会读取或传递密码。")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "取消等待" })[1]);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
