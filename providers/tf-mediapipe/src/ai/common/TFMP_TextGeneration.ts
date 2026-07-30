/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ToolCallingTaskInput } from "@workglow/ai";
import { toTextFlatMessages } from "@workglow/ai/worker";
import { buildGenaiPrompt, resolveTfmpChatTemplate } from "./TFMP_ChatTemplate";
import {
  applyGenaiSamplerOverrides,
  generateGenaiResponse,
  getGenaiLlm,
  withGenaiLock,
} from "./TFMP_GenaiRuntime";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";

/**
 * Unified `["text.generation"]` run-fn: serves TextGenerationTask (prompt)
 * and AiChatTask (messages). Streams text-delta events; the consumer
 * accumulates, so finish carries an empty output.
 */
export const TFMP_TextGeneration: AiProviderRunFn<any, any, TFMPModelConfig> = async (
  input,
  model,
  signal,
  emit
) => {
  const template = resolveTfmpChatTemplate(
    (model!.provider_config as { chat_template?: string }).chat_template
  );
  const messages = toTextFlatMessages(input as ToolCallingTaskInput);
  const prompt = buildGenaiPrompt(messages, template);

  const llm = await getGenaiLlm(model!, emit, signal);
  await withGenaiLock(model!.provider_config.model_path, async () => {
    await applyGenaiSamplerOverrides(llm, input as { temperature?: number });
    await generateGenaiResponse(llm, prompt, signal, (piece) =>
      emit({ type: "text-delta", port: "text", textDelta: piece })
    );
  });

  emit({ type: "finish", data: {} });
};
