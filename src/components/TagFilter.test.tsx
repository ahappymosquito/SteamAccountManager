/** Multi-tag selector coverage for selection, removal and clear-all behavior. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TagFilter } from "./TagFilter";

function Harness() { const [selected, setSelected] = useState<string[]>([]); return <><TagFilter options={[{ name: "主力", usageCount: 2 }, { name: "竞技", usageCount: 1 }]} selected={selected} onChange={setSelected}/><output>{selected.join(",")}</output></>; }
afterEach(cleanup);

describe("TagFilter", () => {
  it("supports multiple selected tags and clear all", async () => {
    const user = userEvent.setup();
    render(<Harness/>);
    await user.click(screen.getByRole("button", { name: "标签" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /主力/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /竞技/ }));
    expect(screen.getByText("主力,竞技")).toBeInTheDocument();
    await user.click(screen.getByText("清空全部标签"));
    expect(screen.getByText("", { selector: "output" })).toBeInTheDocument();
  });
});
