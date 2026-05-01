/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ImageChannels } from "./imageTypes";

/** Internal pixel-buffer shape used by CPU filter ops and codec helpers.
 *  Replaces the old `ImageBinary` export — the boundary type is now `ImageValue`. */
export interface RawPixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: ImageChannels;
  rawChannels?: number | undefined;
}

/** RGBA-only variant. */
export type RgbaPixelBuffer = Readonly<
  Omit<RawPixelBuffer, "channels" | "rawChannels"> & { readonly channels: 4 }
>;
