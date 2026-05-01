/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RawPixelBuffer } from "@workglow/util/media";

import {
  IMAGE_TEXT_RENDER_LINE_HEIGHT_FACTOR,
  IMAGE_TEXT_RENDER_PADDING,
  imageTextRgbaFillStyle,
  parseImageTextAnchor,
  type ImageTextRenderParams,
  type ImageTextRenderer,
} from "./imageTextRender";

function getCanvas2dContext(
  width: number,
  height: number
): {
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("ImageTextTask: failed to get 2D context (OffscreenCanvas)");
    }
    return { canvas, ctx };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("ImageTextTask: failed to get 2D context (HTMLCanvasElement)");
    }
    return { canvas, ctx };
  }
  throw new Error("ImageTextTask: no Canvas implementation available");
}

export function createBrowserImageTextRenderer(): ImageTextRenderer {
  return {
    async renderToRgba(params: ImageTextRenderParams): Promise<RawPixelBuffer> {
      const { width, height, text, font, fontSize, bold, italic, color, position } = params;
      const { ctx } = getCanvas2dContext(width, height);
      ctx.clearRect(0, 0, width, height);

      const style = italic ? "italic " : "";
      const weight = bold ? "bold " : "normal ";
      ctx.font = `${style}${weight}${fontSize}px ${font}`;
      ctx.fillStyle = imageTextRgbaFillStyle(color);
      ctx.textBaseline = "top";

      const lines = text.split("\n");
      const lineHeight = fontSize * IMAGE_TEXT_RENDER_LINE_HEIGHT_FACTOR;
      const blockHeight = lines.length * lineHeight;
      const { row, col } = parseImageTextAnchor(position);

      ctx.textAlign = col === "left" ? "left" : col === "center" ? "center" : "right";

      const startX =
        col === "left"
          ? IMAGE_TEXT_RENDER_PADDING
          : col === "center"
            ? width / 2
            : width - IMAGE_TEXT_RENDER_PADDING;

      const startY =
        row === "top"
          ? IMAGE_TEXT_RENDER_PADDING
          : row === "middle"
            ? (height - blockHeight) / 2
            : height - IMAGE_TEXT_RENDER_PADDING - blockHeight;

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i] ?? "", startX, startY + i * lineHeight);
      }

      const imageData = ctx.getImageData(0, 0, width, height);
      return {
        data: new Uint8ClampedArray(imageData.data),
        width,
        height,
        channels: 4,
      };
    },
  };
}
