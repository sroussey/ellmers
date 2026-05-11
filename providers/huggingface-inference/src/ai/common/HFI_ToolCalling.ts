/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { toOpenAIMessages } from "@workglow/ai/worker";
import type {
  AiProviderStreamFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import {
  accumulateOpenAIStream,
  buildOpenAITools,
  mapOpenAIToolChoice,
} from "@workglow/ai/provider-utils";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import { getClient, getModelName, getProvider } from "./HFI_Client";

export const HFI_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const tools = buildOpenAITools(input.tools);
  const messages = toOpenAIMessages(input);
  const toolChoice = mapOpenAIToolChoice(input.toolChoice, false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: modelName,
    messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    provider,
    stream: true,
  };
  if (toolChoice !== "none") {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const stream = client.chatCompletionStream(params, { signal });

  yield* accumulateOpenAIStream(stream);
};
