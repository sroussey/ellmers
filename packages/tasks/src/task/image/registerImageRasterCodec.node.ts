/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerImageRasterCodec } from "@workglow/util/media";

import { createNodeImageRasterCodec } from "./imageRasterCodec.server";

registerImageRasterCodec(createNodeImageRasterCodec());
