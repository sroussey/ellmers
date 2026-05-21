/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

export const CACTUS_TOOL_USE = ["tool-use"] as const satisfies Capability[];
export const CACTUS_MODEL_DOWNLOAD = ["model.download"] as const satisfies Capability[];
export const CACTUS_MODEL_DOWNLOAD_REMOVE = [
  "model.download-remove",
] as const satisfies Capability[];
export const CACTUS_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const CACTUS_MODEL_INFO = ["model.info"] as const satisfies Capability[];

export const CACTUS_CAPABILITY_SETS = [
  CACTUS_TOOL_USE,
  CACTUS_MODEL_DOWNLOAD,
  CACTUS_MODEL_DOWNLOAD_REMOVE,
  CACTUS_MODEL_SEARCH,
  CACTUS_MODEL_INFO,
] as const;
