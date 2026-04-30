/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageChannels } from "./imageTypes";
import type { GpuImage as IGpuImage, GpuImageEncodeFormat } from "./gpuImage";
import { registerGpuImageFactory } from "./gpuImage";
import type { ImageValue, NodeImageValue } from "./imageValue";
import { isBrowserImageValue, isNodeImageValue } from "./imageValue";

type Sharp = {
  clone(): Sharp;
  flip(): Sharp;
  flop(): Sharp;
  blur(sigma: number): Sharp;
  grayscale(grayscale?: boolean): Sharp;
  negate(options?: { alpha?: boolean }): Sharp;
  recomb(matrix: number[][]): Sharp;
  linear(a: number | number[], b: number | number[]): Sharp;
  threshold(threshold: number, options?: { grayscale?: boolean }): Sharp;
  tint(rgb: { r: number; g: number; b: number }): Sharp;
  ensureAlpha(alpha?: number): Sharp;
  extend(options: { top?: number; bottom?: number; left?: number; right?: number; background?: unknown }): Sharp;
  extract(region: { left: number; top: number; width: number; height: number }): Sharp;
  rotate(angle?: number, options?: { background?: unknown }): Sharp;
  resize(width?: number | null, height?: number | null, options?: { kernel?: string; fit?: string; background?: unknown }): Sharp;
  raw(): Sharp;
  png(opts?: unknown): Sharp;
  jpeg(opts?: unknown): Sharp;
  webp(opts?: unknown): Sharp;
  metadata(): Promise<{ width?: number; height?: number; channels?: number }>;
  toBuffer(opts?: unknown): Promise<Buffer | { data: Buffer; info: { width: number; height: number; channels: number } }>;
};

type SharpModule = (
  input?: Buffer | Uint8ClampedArray,
  opts?: {
    raw?: { width: number; height: number; channels: 1 | 2 | 3 | 4 };
    limitInputPixels?: number;
    sequentialRead?: boolean;
  },
) => Sharp;

let cachedSharp: SharpModule | null = null;
async function loadSharp(): Promise<SharpModule> {
  if (cachedSharp) return cachedSharp;
  let mod: unknown;
  try {
    mod = await import("sharp");
  } catch {
    throw new Error(
      "Server-side image processing requires the optional 'sharp' package. " +
        "Install it with: npm install sharp  (or bun add sharp)"
    );
  }
  cachedSharp = ((mod as { default?: unknown }).default ?? mod) as SharpModule;
  return cachedSharp;
}

export class SharpImage implements IGpuImage {
  readonly backend = "sharp" as const;

  private constructor(
    private pipeline: Sharp | null,
    readonly width: number,
    readonly height: number,
    readonly channels: ImageChannels,
  ) {}

  static async from(value: ImageValue): Promise<SharpImage> {
    if (isBrowserImageValue(value)) {
      throw new Error("SharpImage.from: BrowserImageValue not supported in node runtime");
    }
    if (!isNodeImageValue(value)) {
      throw new Error("SharpImage.from: unrecognized ImageValue shape");
    }
    const sharp = await loadSharp();
    if (value.format === "raw-rgba") {
      const pipeline = sharp(value.buffer, {
        raw: { width: value.width, height: value.height, channels: 4 },
      });
      return new SharpImage(pipeline, value.width, value.height, 4);
    }
    const pipeline = sharp(value.buffer);
    const meta = await pipeline.clone().metadata();
    const channels = (meta.channels ?? 4) as ImageChannels;
    return new SharpImage(pipeline, value.width, value.height, channels);
  }

  apply(op: (p: Sharp) => Sharp, outSize?: { width: number; height: number; channels?: ImageChannels }): SharpImage {
    if (!this.pipeline) throw new Error("SharpImage.apply on a disposed image");
    const next = op(this.pipeline.clone());
    return new SharpImage(
      next,
      outSize?.width ?? this.width,
      outSize?.height ?? this.height,
      outSize?.channels ?? this.channels,
    );
  }

  async toBuffer(format: "png" | "jpeg" | "raw-rgba"): Promise<Buffer> {
    if (!this.pipeline) throw new Error("SharpImage.toBuffer on a disposed image");
    const p = this.pipeline.clone();
    if (format === "raw-rgba") {
      const result = await p.raw().toBuffer({ resolveWithObject: true });
      if (!isObjectResult(result)) throw new Error("SharpImage.toBuffer: expected resolveWithObject result");
      return result.data;
    }
    if (format === "png") return (await p.png().toBuffer()) as Buffer;
    return (await p.jpeg().toBuffer()) as Buffer;
  }

  async toImageValue(previewScale: number): Promise<ImageValue> {
    try {
      const buffer = await this.toBuffer("png");
      const out: NodeImageValue = {
        buffer,
        format: "png",
        width: this.width,
        height: this.height,
        previewScale,
      };
      return out;
    } finally {
      this.dispose();
    }
  }

  async encode(format: GpuImageEncodeFormat, quality?: number): Promise<Uint8Array> {
    if (!this.pipeline) throw new Error("SharpImage.encode on a disposed image");
    const p = this.pipeline.clone();
    let result: unknown;
    if (format === "png") result = await p.png({ quality }).toBuffer();
    else if (format === "jpeg") result = await p.jpeg({ quality }).toBuffer();
    else result = await p.webp({ quality }).toBuffer();
    const buf = result as Buffer;
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  dispose(): void {
    this.pipeline = null;
  }
}

function isObjectResult(r: unknown): r is { data: Buffer; info: { width: number; height: number; channels: number } } {
  return !!r && typeof r === "object" && "data" in r && "info" in r;
}

export interface DecodeBufferToRawOptions {
  readonly limitInputPixels?: number;
  readonly sequentialRead?: boolean;
  readonly ensureAlpha?: boolean;
}

export interface RawPixelInput {
  readonly data: Buffer | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 2 | 3 | 4;
}

export type EncodeRawPixelsOptions =
  | { readonly format: "png"; readonly compressionLevel?: number }
  | { readonly format: "jpeg"; readonly quality?: number; readonly mozjpeg?: boolean }
  | { readonly format: "webp"; readonly quality?: number };

export async function probeImageDimensions(
  buffer: Buffer
): Promise<{ width: number; height: number; channels: number | undefined }> {
  const sharp = await loadSharp();
  const meta = await sharp(buffer).metadata();
  if (typeof meta.width !== "number" || typeof meta.height !== "number") {
    throw new Error("probeImageDimensions: sharp could not read image dimensions");
  }
  return { width: meta.width, height: meta.height, channels: meta.channels };
}

export async function decodeBufferToRaw(
  buffer: Buffer,
  options?: DecodeBufferToRawOptions
): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const sharp = await loadSharp();
  const sharpOpts: { limitInputPixels?: number; sequentialRead?: boolean } = {};
  if (options?.limitInputPixels !== undefined) sharpOpts.limitInputPixels = options.limitInputPixels;
  if (options?.sequentialRead !== undefined) sharpOpts.sequentialRead = options.sequentialRead;
  let pipeline = sharp(buffer, sharpOpts);
  if (options?.ensureAlpha) pipeline = pipeline.ensureAlpha();
  const result = await pipeline.raw().toBuffer({ resolveWithObject: true });
  if (!isObjectResult(result)) throw new Error("decodeBufferToRaw: expected resolveWithObject result");
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: result.info.channels,
  };
}

export async function encodeRawPixels(
  raw: RawPixelInput,
  options: EncodeRawPixelsOptions
): Promise<Buffer> {
  const sharp = await loadSharp();
  const inputBuffer: Buffer =
    raw.data instanceof Uint8ClampedArray
      ? Buffer.from(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength)
      : raw.data;
  const pipeline = sharp(inputBuffer, {
    raw: { width: raw.width, height: raw.height, channels: raw.channels },
  });
  let encoded: unknown;
  if (options.format === "png") {
    encoded = await pipeline.png({ compressionLevel: options.compressionLevel }).toBuffer();
  } else if (options.format === "jpeg") {
    encoded = await pipeline
      .jpeg({ quality: options.quality, mozjpeg: options.mozjpeg })
      .toBuffer();
  } else {
    encoded = await pipeline.webp({ quality: options.quality }).toBuffer();
  }
  return encoded as Buffer;
}

registerGpuImageFactory("from", SharpImage.from.bind(SharpImage));
