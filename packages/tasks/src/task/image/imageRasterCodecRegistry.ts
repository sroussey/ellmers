/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Re-exported from {@link @workglow/util/media} — the registry moved so that
 * the `Image` class can dispatch to the codec without creating a reverse
 * dependency. Implementations (`imageRasterCodecBrowser.ts`,
 * `imageRasterCodecNode.ts`) still live in this package.
 */

export { getImageRasterCodec, registerImageRasterCodec } from "@workglow/util/media";
export type { ImageRasterCodec } from "@workglow/util/media";
