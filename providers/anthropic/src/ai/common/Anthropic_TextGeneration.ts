/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util/worker";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";

export const Anthropic_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal, _outputSchema, sessionId) => {
  const logger = getLogger();
  const timerLabel = `anthropic:TextGeneration:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting Anthropic text generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const params: any = {
    model: modelName,
    messages: [{ role: "user", content: input.prompt }],
    max_tokens: getMaxTokens(input, model),
    temperature: input.temperature,
    top_p: input.topP,
  };

  // Cache annotation placeholder: TextGenerationTaskInput does not currently
  // include a systemPrompt field, so params.system is never set. When system
  // prompt support is added to TextGeneration, this block will activate.
  if (sessionId && params.system) {
    params.system = [
      {
        type: "text",
        text: params.system,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  const response = await client.messages.create(params, { signal });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text generation");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { text };
};

export const Anthropic_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async function* (
  input,
  model,
  signal,
  _outputSchema,
  sessionId
): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const params: any = {
    model: modelName,
    messages: [{ role: "user", content: input.prompt }],
    max_tokens: getMaxTokens(input, model),
    temperature: input.temperature,
    top_p: input.topP,
  };

  // Cache annotation placeholder: see comment in run function above.
  if (sessionId && params.system) {
    params.system = [
      {
        type: "text",
        text: params.system,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  const stream = client.messages.stream(params, { signal });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};
