/** High-DPI approximate canvas preview for parsed CS2 crosshair settings. */
import { useEffect, useRef } from "react";
import type { CrosshairSettings } from "../lib/crosshair";

export type CrosshairBackground = "dark" | "light" | "scene";

const presetColors: Record<number, [number, number, number]> = {
  0: [255, 0, 0],
  1: [0, 255, 0],
  2: [255, 255, 0],
  3: [0, 0, 255],
  4: [0, 255, 255],
};

export function CrosshairPreview({
  settings,
  background,
}: {
  settings: CrosshairSettings;
  background: CrosshairBackground;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 220;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const backgrounds: Record<CrosshairBackground, string> = {
      dark: "#111820",
      light: "#e8edf1",
      scene: "#637a6d",
    };
    context.fillStyle = backgrounds[background];
    context.fillRect(0, 0, width, height);
    if (background === "scene") {
      context.fillStyle = "#7d9585";
      context.fillRect(0, height * 0.56, width, height * 0.44);
      context.fillStyle = "#495a52";
      context.fillRect(width * 0.68, height * 0.2, width * 0.2, height * 0.5);
    }

    const [red, green, blue] =
      settings.color === 5
        ? [settings.red, settings.green, settings.blue]
        : presetColors[settings.color] ?? presetColors[1];
    const alpha = settings.alphaEnabled ? settings.alpha / 255 : 1;
    const color = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = 2;
    const gap = Math.max(0, (settings.gap + 4) * scale);
    const length = Math.max(1, settings.length * scale);
    const thickness = Math.max(1, settings.thickness * scale);
    const segments = [
      [centerX - gap - length, centerY, length, thickness],
      [centerX + gap, centerY, length, thickness],
      [centerX, centerY + gap, thickness, length],
      ...(settings.tStyleEnabled
        ? []
        : [[centerX, centerY - gap - length, thickness, length]]),
    ];

    const drawSegments = (fill: string, expansion: number) => {
      context.fillStyle = fill;
      for (const [x, y, segmentWidth, segmentHeight] of segments) {
        context.fillRect(
          x - expansion - (segmentHeight === thickness ? 0 : thickness / 2),
          y - expansion - (segmentHeight === thickness ? thickness / 2 : 0),
          segmentWidth + expansion * 2,
          segmentHeight + expansion * 2,
        );
      }
    };
    if (settings.outlineEnabled) {
      drawSegments("rgba(0, 0, 0, 0.85)", Math.max(1, settings.outline));
    }
    drawSegments(color, 0);
    if (settings.centerDotEnabled) {
      const dot = Math.max(2, thickness);
      if (settings.outlineEnabled) {
        context.fillStyle = "rgba(0, 0, 0, 0.85)";
        context.fillRect(
          centerX - dot / 2 - settings.outline,
          centerY - dot / 2 - settings.outline,
          dot + settings.outline * 2,
          dot + settings.outline * 2,
        );
      }
      context.fillStyle = color;
      context.fillRect(centerX - dot / 2, centerY - dot / 2, dot, dot);
    }
  }, [background, settings]);

  return (
    <canvas
      ref={canvasRef}
      className="crosshair-canvas"
      aria-label="准星近似预览"
    />
  );
}
