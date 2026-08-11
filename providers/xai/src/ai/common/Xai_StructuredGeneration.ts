/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  Usage,
} from "@workglow/ai";
import {
  createEstimatedOutputUsageReporter,
  isStrictCompatibleSchema,
  mapOpenAIChatUsage,
  OPENAI_STREAM_USAGE_OPTIONS,
} from "@workglow/ai/provider-utils";
import { createPartialJsonStream } from "@workglow/util/worker";
import { getClient, getModelName } from "./Xai_Client";
import type { XaiModelConfig } from "./Xai_ModelSchema";

/**
 * Streaming run-fn for `["text.generation", "json-mode"]`. Emits
 * `object-delta` events with progressively-completed partial JSON snapshots
 * on the `object` port, ending with a `finish` event carrying the parsed
 * final object.
 */
export const Xai_StructuredGeneration_Stream: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  XaiModelConfig
> = async (input, model, signal, emit, outputSchema) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  // xAI only attaches billed usage to the final empty-choices chunk, so without
  // a provisional estimate the CLI row stays on a static "Preparing" for the
  // whole TTFB wait. Emit ↑ before the request so it appears during connect;
  // finish.usage below still carries the provider total.
  const provisionalUsage = createEstimatedOutputUsageReporter(emit);
  provisionalUsage.onPrompt(input.prompt);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      response_format: {
        type: "json_schema" as never,
        json_schema: {
          name: "structured_output",
          schema: schema,
          strict: isStrictCompatibleSchema(schema),
        },
      } as never,
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      stream: true,
      ...OPENAI_STREAM_USAGE_OPTIONS,
    },
    { signal }
  );

  const json = createPartialJsonStream();
  let refusal = "";
  let usage: Usage | undefined;
  for await (const chunk of stream) {
    usage = mapOpenAIChatUsage(chunk.usage) ?? usage;
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      provisionalUsage.onText(delta);
      const partial = json.push(delta);
      if (partial !== undefined) {
        emit({ type: "object-delta", port: "object", objectDelta: partial });
      }
    }
    refusal += chunk.choices?.[0]?.delta?.refusal ?? "";
  }
  provisionalUsage.flush();

  if (refusal) {
    emit({ type: "refusal", refusal });
  }

  emit({
    type: "finish",
    data: { object: json.finishObject() } as StructuredGenerationTaskOutput,
    usage,
  });
};
