/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderStreamFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getClient, getModelName } from "./Anthropic_Client";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

export const Anthropic_CountTokens_Stream: AiProviderStreamFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<CountTokensTaskOutput>> {
  const client = await getClient(model);
  const result = await client.messages.countTokens({
    model: getModelName(model),
    messages: [{ role: "user", content: input.text }],
  });
  yield { type: "finish", data: { count: result.input_tokens } };
};

export const Anthropic_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async (input, _model) => {
  return { count: Math.ceil(input.text.length / 4) };
};
