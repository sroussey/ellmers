/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageChannels } from "./imageTypes";
import type {
  GpuImage as IGpuImage,
  GpuImageEncodeFormat,
} from "./gpuImage";
import type { ImageValue, NodeImageValue } from "./imageValue";
import { isBrowserImageValue, isNodeImageValue } from "./imageValue";
import { getImageRasterCodec } from "./imageRasterCodecRegistry";
import type { RawPixelBuffer } from "./rawPixelBuffer";

export type { RawPixelBuffer } from "./rawPixelBuffer";

const FORMAT_TO_MIME: Record<GpuImageEncodeFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export class CpuImage implements IGpuImage {
  readonly backend = "cpu" as const;

  private constructor(private bin: RawPixelBuffer | null) {}

  get width(): number {
    if (!this.bin) throw new Error("CpuImage.width on a disposed image");
    return this.bin.width;
  }
  get height(): number {
    if (!this.bin) throw new Error("CpuImage.height on a disposed image");
    return this.bin.height;
  }
  get channels(): ImageChannels {
    if (!this.bin) throw new Error("CpuImage.channels on a disposed image");
    return this.bin.channels;
  }

  /** @internal — used by CPU filter ops to read the raw pixel buffer. */
  getBinary(): RawPixelBuffer {
    if (!this.bin) throw new Error("CpuImage.getBinary on a disposed image");
    return this.bin;
  }

  static async from(value: ImageValue): Promise<CpuImage> {
    if (isBrowserImageValue(value)) {
      if (typeof OffscreenCanvas === "undefined") {
        throw new Error("CpuImage.from(BrowserImageValue) requires OffscreenCanvas");
      }
      const off = new OffscreenCanvas(value.width, value.height);
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("CpuImage.from: could not acquire 2D context");
      ctx.drawImage(value.bitmap, 0, 0);
      const id = ctx.getImageData(0, 0, value.width, value.height);
      return new CpuImage({ data: id.data, width: value.width, height: value.height, channels: 4 });
    }
    if (isNodeImageValue(value)) {
      const bin = await decodeNodeImageValue(value);
      return new CpuImage(bin);
    }
    throw new Error("CpuImage.from: unrecognized ImageValue shape");
  }

  /** @internal — synchronous factory for backends that already have a raw buffer
   *  in hand (used by the WGSL CPU fallback). */
  static fromRaw(bin: RawPixelBuffer): CpuImage {
    return new CpuImage(bin);
  }

  async toImageValue(previewScale: number): Promise<ImageValue> {
    if (!this.bin) throw new Error("CpuImage.toImageValue on a disposed image");
    if (typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap === "function") {
      const off = new OffscreenCanvas(this.bin.width, this.bin.height);
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("CpuImage.toImageValue could not acquire a 2D context");
      const rgba = expandToRgba(this.bin);
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), this.bin.width, this.bin.height),
        0,
        0,
      );
      const bitmap = await createImageBitmap(off);
      const out: ImageValue = {
        bitmap,
        width: this.bin.width,
        height: this.bin.height,
        previewScale,
      } as ImageValue;
      this.bin = null;
      return out;
    }
    // Node fallback: encode to raw-rgba Buffer.
    const rgba = expandToRgba(this.bin);
    const buffer = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const out: NodeImageValue = {
      buffer,
      format: "raw-rgba",
      width: this.bin.width,
      height: this.bin.height,
      previewScale,
    };
    this.bin = null;
    return out;
  }

  async encode(format: GpuImageEncodeFormat, _quality?: number): Promise<Uint8Array> {
    if (!this.bin) throw new Error("CpuImage.encode on a disposed image");
    const codec = getImageRasterCodec();
    const dataUri = await codec.encodeDataUri(this.bin, FORMAT_TO_MIME[format]);
    return dataUriToBytes(dataUri);
  }

  dispose(): void {
    this.bin = null;
  }
}

function expandToRgba(bin: RawPixelBuffer): Uint8ClampedArray {
  if (bin.channels === 4) return bin.data;
  const px = bin.width * bin.height;
  const out = new Uint8ClampedArray(px * 4);
  if (bin.channels === 3) {
    for (let i = 0; i < px; i++) {
      out[i * 4 + 0] = bin.data[i * 3 + 0] ?? 0;
      out[i * 4 + 1] = bin.data[i * 3 + 1] ?? 0;
      out[i * 4 + 2] = bin.data[i * 3 + 2] ?? 0;
      out[i * 4 + 3] = 255;
    }
  } else if (bin.channels === 1) {
    for (let i = 0; i < px; i++) {
      const g = bin.data[i] ?? 0;
      out[i * 4 + 0] = g;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = g;
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

function dataUriToBytes(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(",");
  const b64 = dataUri.slice(comma + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function decodeNodeImageValue(value: NodeImageValue): Promise<RawPixelBuffer> {
  if (value.format === "raw-rgba") {
    const data = new Uint8ClampedArray(value.buffer.buffer, value.buffer.byteOffset, value.buffer.byteLength);
    return { data, width: value.width, height: value.height, channels: 4 };
  }
  const codec = getImageRasterCodec();
  const dataUri = `data:image/${value.format};base64,${value.buffer.toString("base64")}`;
  const decoded = await codec.decodeDataUri(dataUri);
  return {
    data: decoded.data,
    width: decoded.width,
    height: decoded.height,
    channels: decoded.channels as ImageChannels,
  };
}
