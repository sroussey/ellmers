/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "@workglow/util";
import type { RawPixelBuffer } from "@workglow/util/media";

import { assertWithinPixelBudget } from "./imageCodecLimits";

export const IMAGE_TEXT_ANCHOR_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type ImageTextAnchorPosition = (typeof IMAGE_TEXT_ANCHOR_POSITIONS)[number];

export interface ImageTextRenderColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

export interface ImageTextRenderParams {
  readonly text: string;
  readonly font: string;
  readonly fontSize: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly color: ImageTextRenderColor;
  readonly width: number;
  readonly height: number;
  readonly position: ImageTextAnchorPosition;
}

export interface ImageTextRenderer {
  renderToRgba(params: ImageTextRenderParams): Promise<RawPixelBuffer>;
}

export const IMAGE_TEXT_RENDERER = createServiceToken<ImageTextRenderer>(
  "@workglow/tasks/image-text-renderer"
);

export const IMAGE_TEXT_RENDER_PADDING = 2;
export const IMAGE_TEXT_RENDER_LINE_HEIGHT_FACTOR = 1.25;

export function parseImageTextAnchor(position: ImageTextAnchorPosition): {
  readonly row: "top" | "middle" | "bottom";
  readonly col: "left" | "center" | "right";
} {
  const [row, col] = position.split("-") as [
    "top" | "middle" | "bottom",
    "left" | "center" | "right",
  ];
  return { row, col };
}

export function escapeImageTextXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export function escapeImageTextXmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function imageTextRgbaFillStyle(color: ImageTextRenderColor): string {
  const alpha = (color.a ?? 255) / 255;
  return `rgba(${color.r},${color.g},${color.b},${alpha})`;
}

export function registerImageTextRenderer(renderer: ImageTextRenderer): void {
  globalServiceRegistry.registerInstance(IMAGE_TEXT_RENDERER, renderer);
}

export function getImageTextRenderer(): ImageTextRenderer {
  if (!globalServiceRegistry.has(IMAGE_TEXT_RENDERER)) {
    throw new Error(
      "Image text renderer not registered. Import @workglow/tasks from a platform entry (browser, node, bun, or electron) before using ImageTextTask."
    );
  }
  return globalServiceRegistry.get(IMAGE_TEXT_RENDERER);
}

export async function renderImageTextToRgba(params: ImageTextRenderParams): Promise<RawPixelBuffer> {
  assertWithinPixelBudget(params.width, params.height);
  return getImageTextRenderer().renderToRgba(params);
}
