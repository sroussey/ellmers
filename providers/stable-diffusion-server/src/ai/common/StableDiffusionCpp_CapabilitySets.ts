/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

export const STABLE_DIFFUSION_CPP_IMAGE_GENERATION = [
  "image.generation",
] as const satisfies Capability[];
export const STABLE_DIFFUSION_CPP_IMAGE_EDITING = ["image.editing"] as const satisfies Capability[];
export const STABLE_DIFFUSION_CPP_MODEL_INFO = ["model.info"] as const satisfies Capability[];
export const STABLE_DIFFUSION_CPP_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];

/** Order MUST match STABLE_DIFFUSION_CPP_RUN_FNS in JobRunFns. */
export const STABLE_DIFFUSION_CPP_CAPABILITY_SETS = [
  STABLE_DIFFUSION_CPP_IMAGE_GENERATION,
  STABLE_DIFFUSION_CPP_IMAGE_EDITING,
  STABLE_DIFFUSION_CPP_MODEL_SEARCH,
  STABLE_DIFFUSION_CPP_MODEL_INFO,
] as const;
