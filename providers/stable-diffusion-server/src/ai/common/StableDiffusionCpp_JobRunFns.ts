/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFnRegistration } from "@workglow/ai";
import {
  STABLE_DIFFUSION_CPP_IMAGE_EDITING,
  STABLE_DIFFUSION_CPP_IMAGE_GENERATION,
  STABLE_DIFFUSION_CPP_MODEL_INFO,
  STABLE_DIFFUSION_CPP_MODEL_SEARCH,
} from "./StableDiffusionCpp_CapabilitySets";
import { type IStableDiffusionCppProviderOptions } from "./StableDiffusionCpp_Client";
import { createStableDiffusionCppImageEditRunFn } from "./StableDiffusionCpp_ImageEdit";
import { createStableDiffusionCppImageGenerateRunFn } from "./StableDiffusionCpp_ImageGenerate";
import { createStableDiffusionCppModelInfoRunFn } from "./StableDiffusionCpp_ModelInfo";
import type { StableDiffusionCppModelConfig } from "./StableDiffusionCpp_ModelSchema";
import { createStableDiffusionCppModelSearchRunFn } from "./StableDiffusionCpp_ModelSearch";

export function buildStableDiffusionCppRunFns(
  opts: IStableDiffusionCppProviderOptions
): readonly AiProviderRunFnRegistration<any, any, StableDiffusionCppModelConfig>[] {
  return [
    {
      serves: STABLE_DIFFUSION_CPP_IMAGE_GENERATION,
      runFn: createStableDiffusionCppImageGenerateRunFn(opts),
    },
    {
      serves: STABLE_DIFFUSION_CPP_IMAGE_EDITING,
      runFn: createStableDiffusionCppImageEditRunFn(opts),
    },
    {
      serves: STABLE_DIFFUSION_CPP_MODEL_SEARCH,
      runFn: createStableDiffusionCppModelSearchRunFn(opts),
    },
    {
      serves: STABLE_DIFFUSION_CPP_MODEL_INFO,
      runFn: createStableDiffusionCppModelInfoRunFn(opts),
    },
  ];
}
