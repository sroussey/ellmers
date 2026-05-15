/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ToolCallingTaskInput, ToolCallingTaskOutput } from "@workglow/ai";
import {
  accumulateOpenAIStream,
  buildOpenAITools,
  mapOpenAIToolChoice,
} from "@workglow/ai/provider-utils";
import { toOpenAIMessages } from "@workglow/ai/worker";
import { getClient, getModelName, getProvider } from "./HFI_Client";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

export const HFI_ToolCalling_Stream: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfInferenceModelConfig
> = async (input, model, signal, emit) => {
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

  for await (const e of accumulateOpenAIStream(stream)) {
    emit(e);
  }
};
