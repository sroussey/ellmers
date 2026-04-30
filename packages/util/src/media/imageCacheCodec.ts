/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerPortCodec } from "@workglow/util";
import type { BrowserImageValue, ImageValue, NodeImageFormat } from "./imageValue";
import { imageValueFromBuffer, isBrowserImageValue, isNodeImageValue } from "./imageValue";

/**
 * Cache codec for `format: "image"` ports.
 *
 * Produces a JSON-safe wire form so persistent caches (e.g. `TaskOutputTabularRepository`,
 * which stringifies before writing to disk) can round-trip image outputs. The wire form
 * carries encoded bytes plus dimensions and `previewScale`; the decoded shape is the
 * platform-native `ImageValue` (browser → `BrowserImageValue`, node/bun → `NodeImageValue`).
 *
 * Cross-platform read is supported: a node-written cache entry decodes to a
 * `BrowserImageValue` when read in the browser (via `createImageBitmap`), and vice versa.
 */
export interface ImageValueWire {
  readonly __imageValueWire: 1;
  readonly format: NodeImageFormat;
  readonly base64: string;
  readonly width: number;
  readonly height: number;
  readonly previewScale: number;
}

function isImageValueWire(v: unknown): v is ImageValueWire {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.__imageValueWire === 1 &&
    typeof o.base64 === "string" &&
    (o.format === "png" || o.format === "jpeg" || o.format === "raw-rgba") &&
    typeof o.width === "number" &&
    typeof o.height === "number" &&
    typeof o.previewScale === "number"
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function browserToPngBase64(value: BrowserImageValue): Promise<string> {
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("imageCacheCodec.serialize: BrowserImageValue requires OffscreenCanvas");
  }
  const off = new OffscreenCanvas(value.width, value.height);
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("imageCacheCodec.serialize: could not acquire 2D context");
  ctx.drawImage(value.bitmap, 0, 0);
  const blob = await off.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(bytes);
}

async function wireToBrowserImageValue(wire: ImageValueWire): Promise<BrowserImageValue> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("imageCacheCodec.deserialize: browser path requires createImageBitmap");
  }
  const bytes = base64ToBytes(wire.base64);
  if (wire.format === "raw-rgba") {
    if (typeof ImageData === "undefined") {
      throw new Error("imageCacheCodec.deserialize: raw-rgba decode requires ImageData");
    }
    // The DOM `ImageData` constructor wants `Uint8ClampedArray<ArrayBuffer>`
    // but `bytes.buffer` widens to `ArrayBufferLike`. Cast through unknown:
    // we just produced these bytes via base64 decode, so they're not a
    // SharedArrayBuffer at runtime.
    const data = new Uint8ClampedArray(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ) as unknown as Uint8ClampedArray<ArrayBuffer>;
    const imageData = new ImageData(data, wire.width, wire.height);
    const bitmap = await createImageBitmap(imageData);
    return { bitmap, width: wire.width, height: wire.height, previewScale: wire.previewScale };
  }
  const mime = wire.format === "jpeg" ? "image/jpeg" : "image/png";
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  const bitmap = await createImageBitmap(blob);
  return { bitmap, width: wire.width, height: wire.height, previewScale: wire.previewScale };
}

/**
 * The codec is registered for the `image` format prefix, so it also receives
 * sub-formats like `image:data-uri` (used by `FileLoaderTask` to emit base64
 * data URLs). Strings are already JSON-safe, so they pass through both
 * directions unchanged. The wire form is only used for live `ImageValue`
 * inputs that need to survive `JSON.stringify`.
 */
registerPortCodec<ImageValue | string, ImageValueWire | string>("image", {
  async serialize(value): Promise<ImageValueWire | string> {
    if (typeof value === "string") return value;
    if (isNodeImageValue(value)) {
      return {
        __imageValueWire: 1,
        format: value.format,
        base64: value.buffer.toString("base64"),
        width: value.width,
        height: value.height,
        previewScale: value.previewScale,
      };
    }
    if (isBrowserImageValue(value)) {
      const base64 = await browserToPngBase64(value);
      return {
        __imageValueWire: 1,
        format: "png",
        base64,
        width: value.width,
        height: value.height,
        previewScale: value.previewScale,
      };
    }
    throw new Error("imageCacheCodec.serialize: value is not an ImageValue or string");
  },

  async deserialize(wire): Promise<ImageValue | string> {
    if (typeof wire === "string") return wire;
    if (!isImageValueWire(wire)) {
      throw new Error("imageCacheCodec.deserialize: input is not an ImageValueWire or string");
    }
    if (typeof Buffer !== "undefined") {
      return imageValueFromBuffer(
        Buffer.from(wire.base64, "base64"),
        wire.format,
        wire.width,
        wire.height,
        wire.previewScale,
      );
    }
    return wireToBrowserImageValue(wire);
  },
});
