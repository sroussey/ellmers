/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { getGenaiLlm, isGenaiBusy, peekGenaiLlm, withGenaiLock } from "./TFMP_GenaiRuntime";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";

export const TFMP_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  TFMPModelConfig
> = async (input, model, signal, emit) => {
  const count = await withGenaiLock(model!.provider_config.model_path, async () => {
    const llm = await getGenaiLlm(model!, emit, signal);
    return llm.sizeInTokens(input.text);
  });
  if (typeof count !== "number") {
    throw new PermanentJobError("Failed to tokenize input for count-tokens");
  }
  emit({ type: "finish", data: { count } });
};

/**
 * Preview must never trigger a multi-hundred-MB model load, nor queue behind a
 * running generation: it answers only when the instance is already resident and
 * the model is idle.
 */
export const TFMP_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  TFMPModelConfig
> = async (input, model) => {
  const model_path = model!.provider_config.model_path;
  if (isGenaiBusy(model_path)) return undefined;
  try {
    const count = await withGenaiLock(model_path, async () => {
      // Resolve the instance under the lock rather than capturing it before:
      // the lock is what guarantees `closeGenaiLlm` has not closed and
      // de-cached it by the time `sizeInTokens` runs.
      const llm = peekGenaiLlm(model!);
      if (!llm) return undefined;
      return llm.sizeInTokens(input.text);
    });
    return typeof count === "number" ? { count } : undefined;
  } catch {
    return undefined;
  }
};
