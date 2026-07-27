/** Tests official CS2 crosshair encoding and incomplete/invalid CFG handling. */
import { describe, expect, it } from "vitest";
import {
  cfgCrosshairCommands,
  officialCrosshairShareCode,
  readCrosshair,
} from "./crosshair";
import { parseCfg } from "./cfgDocument";

const knownVector = `cl_crosshairgap -2.2
cl_crosshair_outlinethickness 1
cl_crosshaircolor_r 50
cl_crosshaircolor_g 250
cl_crosshaircolor_b 50
cl_crosshairalpha 200
cl_crosshair_dynamic_splitdist 3
cl_crosshair_recoil 1
cl_fixedcrosshairgap 3
cl_crosshaircolor 1
cl_crosshair_drawoutline 1
cl_crosshair_dynamic_splitalpha_innermod 0
cl_crosshair_dynamic_splitalpha_outermod 1
cl_crosshair_dynamic_maxdist_splitratio 1
cl_crosshairthickness 0.6
cl_crosshairdot 0
cl_crosshairgap_useweaponvalue 1
cl_crosshairusealpha 1
cl_crosshair_t 0
cl_crosshairstyle 2
cl_crosshairsize 10
`;

describe("crosshair settings", () => {
  it("matches a published codec vector", () => {
    expect(officialCrosshairShareCode(parseCfg(knownVector))).toBe(
      "CSGO-WsnnD-eHaMw-QNDf9-oxuDh-ydOUD",
    );
  });

  it("does not fabricate an official code when fields are missing or invalid", () => {
    const missing = readCrosshair(parseCfg("cl_crosshairsize 2\n"));
    expect(missing.settings).toBeUndefined();
    expect(missing.missing).toContain("cl_crosshairgap");

    const invalid = readCrosshair(
      parseCfg(knownVector.replace("cl_crosshairalpha 200", "cl_crosshairalpha nope")),
    );
    expect(invalid.settings).toBeUndefined();
    expect(invalid.invalid).toContain("cl_crosshairalpha");
  });

  it("copies only crosshair command lines in their original order", () => {
    expect(
      cfgCrosshairCommands(
        parseCfg("volume 0.5\r\ncl_crosshairsize 2\r\ncl_crosshairdot 1\r\n"),
      ),
    ).toBe("cl_crosshairsize 2\r\ncl_crosshairdot 1");
  });
});
