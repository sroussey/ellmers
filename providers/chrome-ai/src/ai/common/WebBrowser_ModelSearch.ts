/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelSearchResultItem,
  ModelSearchTaskInput,
  ModelSearchTaskOutput,
} from "@workglow/ai";
import { filterLabeledModelsByQuery } from "@workglow/ai/provider-utils";
import { WEB_BROWSER } from "./WebBrowser_Constants";

const WEB_BROWSER_MODELS: Array<{ label: string; value: string }> = [
  { label: "webgpu  WebGPU inference", value: "webgpu" },
  { label: "wasm  WASM inference", value: "wasm" },
];

export const WebBrowser_ModelSearch: AiProviderRunFn<
  ModelSearchTaskInput,
  ModelSearchTaskOutput
> = async (input, _model, _signal, emit) => {
  const models = filterLabeledModelsByQuery(WEB_BROWSER_MODELS, input.query);
  const results: ModelSearchResultItem[] = models.map((m) => ({
    id: m.value,
    label: m.label,
    description: "",
    record: {
      model_id: m.value,
      provider: WEB_BROWSER,
      title: m.value,
      description: "",
      capabilities: [
        "model.info",
        "text.generation",
        "text.summary",
        "text.language-detection",
        "text.translation",
        "text.rewriter",
      ],
      provider_config: {},
      metadata: {},
    },
    raw: m,
  }));
  emit({ type: "finish", data: { results } });
};
