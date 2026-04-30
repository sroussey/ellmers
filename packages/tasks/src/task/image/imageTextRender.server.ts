/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RawPixelBuffer } from "@workglow/util/media";
import { decodeBufferToRaw } from "@workglow/util/media";

import { MAX_DECODED_PIXELS } from "./imageCodecLimits";
import {
  escapeImageTextXmlAttr,
  escapeImageTextXmlText,
  IMAGE_TEXT_RENDER_LINE_HEIGHT_FACTOR,
  IMAGE_TEXT_RENDER_PADDING,
  imageTextRgbaFillStyle,
  parseImageTextAnchor,
  type ImageTextRenderer,
  type ImageTextRenderParams,
} from "./imageTextRender";

function buildTextSvg(params: ImageTextRenderParams): string {
  const { width, height, text, font, fontSize, bold, italic, color, position } = params;
  const lines = escapeImageTextXmlText(text).split("\n");
  const lineHeight = fontSize * IMAGE_TEXT_RENDER_LINE_HEIGHT_FACTOR;
  const blockHeight = lines.length * lineHeight;
  const { row, col } = parseImageTextAnchor(position);

  const textAnchor: "start" | "middle" | "end" =
    col === "left" ? "start" : col === "center" ? "middle" : "end";
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

  const fontWeight = bold ? "bold" : "normal";
  const fontStyle = italic ? "italic" : "normal";
  const fill = escapeImageTextXmlAttr(imageTextRgbaFillStyle(color));
  const fontFamily = escapeImageTextXmlAttr(font);

  const tspans: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (i === 0) {
      tspans.push(`<tspan x="${startX}" y="${startY}">${line}</tspan>`);
    } else {
      tspans.push(`<tspan x="${startX}" dy="${lineHeight}">${line}</tspan>`);
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<text xml:space="preserve" font-family="${fontFamily}" font-size="${fontSize}" ` +
    `font-weight="${fontWeight}" font-style="${fontStyle}" fill="${fill}" ` +
    `text-anchor="${textAnchor}" dominant-baseline="hanging">` +
    tspans.join("") +
    `</text></svg>`
  );
}

export function createServerImageTextRenderer(): ImageTextRenderer {
  return {
    async renderToRgba(params: ImageTextRenderParams): Promise<RawPixelBuffer> {
      const svg = buildTextSvg(params);
      const buffer = Buffer.from(svg, "utf8");
      const { data, width, height, channels } = await decodeBufferToRaw(buffer, {
        limitInputPixels: MAX_DECODED_PIXELS,
        sequentialRead: true,
        ensureAlpha: true,
      });

      if (channels !== 4) {
        throw new Error(`ImageTextTask: expected RGBA from sharp, got ${channels} channels`);
      }

      return {
        data: new Uint8ClampedArray(data),
        width,
        height,
        channels: 4,
      };
    },
  };
}
