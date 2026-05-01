/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { RawPixelBuffer } from "./rawPixelBuffer";
import { getImageRasterCodec } from "./imageRasterCodecRegistry";

async function rawPixelBufferToBytes(bin: RawPixelBuffer, mimeType: string): Promise<Uint8Array> {
  const dataUri = await getImageRasterCodec().encodeDataUri(bin, mimeType);
  const b64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const decoded = atob(b64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

export async function rawPixelBufferToDataUri(
  bin: RawPixelBuffer,
  mimeType = "image/png",
): Promise<string> {
  return getImageRasterCodec().encodeDataUri(bin, mimeType);
}

export async function rawPixelBufferToBlob(
  bin: RawPixelBuffer,
  mimeType = "image/png",
): Promise<Blob> {
  const bytes = await rawPixelBufferToBytes(bin, mimeType);
  return new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
}
