/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  ModelSearchTaskInput,
  ModelSearchTaskOutput,
} from "@workglow/ai";
import { searchHfModels, mapHfModelResult } from "@workglow/ai/provider-utils";
import type { StreamEvent } from "@workglow/task-graph";
import { LOCAL_LLAMACPP } from "./LlamaCpp_Constants";

export const LlamaCpp_ModelSearch: AiProviderStreamFn<
  ModelSearchTaskInput,
  ModelSearchTaskOutput
> = async function* (input, _model, signal): AsyncIterable<StreamEvent<ModelSearchTaskOutput>> {
  const entries = await searchHfModels(
    input.query?.trim() ?? "",
    { filter: "gguf" },
    undefined,
    signal
  );
  const results = entries.map((entry) => mapHfModelResult(entry, LOCAL_LLAMACPP));
  yield { type: "finish", data: { results } };
};
