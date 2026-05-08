/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelSearchTaskInput, ModelSearchTaskOutput } from "@workglow/ai";
import { searchHfModels, mapHfModelResult } from "@workglow/ai/provider-utils";
import { HF_TRANSFORMERS_ONNX } from "./HFT_Constants";
import { parseOnnxQuantizations } from "./HFT_OnnxDtypes";

export const HFT_ModelSearch: AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput> = async (
  input,
  _model,
  _onProgress,
  signal
) => {
  const entries = await searchHfModels(
    input.query?.trim() ?? "",
    { filter: "onnx" },
    ["siblings"],
    signal
  );
  const results = entries.map((entry) => {
    const item = mapHfModelResult(entry, HF_TRANSFORMERS_ONNX);

    // Parse ONNX quantizations from siblings and include in record
    if (entry.siblings && entry.siblings.length > 0) {
      const filePaths = entry.siblings.map((s) => s.rfilename);
      const quantizations = parseOnnxQuantizations({ filePaths });
      if (quantizations.length > 0) {
        const record = item.record as Record<string, unknown>;
        const providerConfig = (record.provider_config ?? {}) as Record<string, unknown>;
        providerConfig.quantizations = quantizations;
        record.provider_config = providerConfig;
      }
    }

    // Strip raw siblings data — consumers get pre-parsed quantizations
    const raw = item.raw as Record<string, unknown>;
    delete raw.siblings;

    return item;
  });
  return { results };
};
