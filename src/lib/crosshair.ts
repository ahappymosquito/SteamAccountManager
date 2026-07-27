/** Maps losslessly parsed CFG commands to preview values and official CS2 share codes. */
import { encodeCrosshair, type Crosshair } from "csgo-sharecode";
import {
  commandValue,
  effectiveCommand,
  type CfgDocument,
} from "./cfgDocument";

export type CrosshairSettings = Crosshair;

type NumericField = {
  key: keyof CrosshairSettings;
  command: string;
  min: number;
  max: number;
  integer?: boolean;
};

type BooleanField = {
  key: keyof CrosshairSettings;
  command: string;
};

const numericFields: NumericField[] = [
  { key: "length", command: "cl_crosshairsize", min: 0, max: 255.5 },
  { key: "red", command: "cl_crosshaircolor_r", min: 0, max: 255, integer: true },
  { key: "green", command: "cl_crosshaircolor_g", min: 0, max: 255, integer: true },
  { key: "blue", command: "cl_crosshaircolor_b", min: 0, max: 255, integer: true },
  { key: "gap", command: "cl_crosshairgap", min: -128, max: 127.9 },
  { key: "alpha", command: "cl_crosshairalpha", min: 0, max: 255, integer: true },
  { key: "outline", command: "cl_crosshair_outlinethickness", min: 0, max: 3 },
  { key: "color", command: "cl_crosshaircolor", min: 0, max: 5, integer: true },
  { key: "thickness", command: "cl_crosshairthickness", min: 0, max: 255.5 },
  { key: "splitDistance", command: "cl_crosshair_dynamic_splitdist", min: 0, max: 127, integer: true },
  { key: "fixedCrosshairGap", command: "cl_fixedcrosshairgap", min: -128, max: 127.9 },
  { key: "innerSplitAlpha", command: "cl_crosshair_dynamic_splitalpha_innermod", min: 0, max: 1 },
  { key: "outerSplitAlpha", command: "cl_crosshair_dynamic_splitalpha_outermod", min: 0, max: 1 },
  { key: "splitSizeRatio", command: "cl_crosshair_dynamic_maxdist_splitratio", min: 0, max: 1 },
  { key: "style", command: "cl_crosshairstyle", min: 0, max: 5, integer: true },
];

const booleanFields: BooleanField[] = [
  { key: "alphaEnabled", command: "cl_crosshairusealpha" },
  { key: "outlineEnabled", command: "cl_crosshair_drawoutline" },
  { key: "centerDotEnabled", command: "cl_crosshairdot" },
  { key: "followRecoil", command: "cl_crosshair_recoil" },
  { key: "tStyleEnabled", command: "cl_crosshair_t" },
  { key: "deployedWeaponGapEnabled", command: "cl_crosshairgap_useweaponvalue" },
];

export const crosshairCommands = [
  ...numericFields.map((field) => field.command),
  ...booleanFields.map((field) => field.command),
];

export type CrosshairReadResult = {
  settings?: CrosshairSettings;
  preview: CrosshairSettings;
  missing: string[];
  invalid: string[];
};

const previewFallback: CrosshairSettings = {
  length: 5,
  red: 50,
  green: 250,
  blue: 50,
  gap: -1,
  alphaEnabled: true,
  alpha: 255,
  outlineEnabled: true,
  outline: 1,
  color: 5,
  thickness: 1,
  centerDotEnabled: false,
  splitDistance: 7,
  followRecoil: false,
  fixedCrosshairGap: 3,
  innerSplitAlpha: 1,
  outerSplitAlpha: 0.5,
  splitSizeRatio: 0.35,
  tStyleEnabled: false,
  deployedWeaponGapEnabled: false,
  style: 4,
};

export function readCrosshair(document: CfgDocument): CrosshairReadResult {
  const preview = { ...previewFallback };
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const field of numericFields) {
    const raw = commandValue(effectiveCommand(document, field.command));
    if (raw === undefined) {
      missing.push(field.command);
      continue;
    }
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      value < field.min ||
      value > field.max ||
      (field.integer && !Number.isInteger(value))
    ) {
      invalid.push(field.command);
      continue;
    }
    (preview[field.key] as number) = value;
  }

  for (const field of booleanFields) {
    const raw = commandValue(effectiveCommand(document, field.command));
    if (raw === undefined) {
      missing.push(field.command);
      continue;
    }
    if (raw !== "0" && raw !== "1") {
      invalid.push(field.command);
      continue;
    }
    (preview[field.key] as boolean) = raw === "1";
  }

  return {
    settings:
      missing.length === 0 && invalid.length === 0 ? { ...preview } : undefined,
    preview,
    missing,
    invalid,
  };
}

export function officialCrosshairShareCode(document: CfgDocument) {
  const result = readCrosshair(document);
  return result.settings ? encodeCrosshair(result.settings) : undefined;
}

export function cfgCrosshairCommands(document: CfgDocument) {
  return document.commands
    .filter((node) => node.section === "crosshair")
    .map((node) => node.raw)
    .join(document.newline);
}
