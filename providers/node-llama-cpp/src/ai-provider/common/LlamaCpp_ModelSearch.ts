/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelSearchTaskInput, ModelSearchTaskOutput } from "@workglow/ai";
import { searchHfModels, mapHfModelResult } from "@workglow/ai-provider/common";
import { LOCAL_LLAMACPP } from "./LlamaCpp_Constants";

export const LlamaCpp_ModelSearch: AiProviderRunFn<
  ModelSearchTaskInput,
  ModelSearchTaskOutput
> = async (input, _model, _onProgress, signal) => {
  const entries = await searchHfModels(
    input.query?.trim() ?? "",
    { filter: "gguf" },
    undefined,
    signal
  );
  const results = entries.map((entry) => mapHfModelResult(entry, LOCAL_LLAMACPP));
  return { results };
};
