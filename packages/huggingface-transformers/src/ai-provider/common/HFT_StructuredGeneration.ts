/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Message,
  TextGenerationOutput,
  TextGenerationPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "./HFT_Streaming";
import { extractGeneratedText } from "./HFT_TextOutput";

function buildStructuredGenerationPrompt(input: StructuredGenerationTaskInput): string {
  const schemaStr = JSON.stringify(input.outputSchema, null, 2);
  return (
    `${input.prompt}\n\n` +
    `You MUST respond with ONLY a valid JSON object conforming to this JSON schema:\n${schemaStr}\n\n` +
    `Output ONLY the JSON object, no other text.`
  );
}

/**
 * Strip thinking blocks (`<think>...</think>`) and HFT special tokens
 * (`<|im_end|>`, `<|end_of_turn|>`, etc.) that thinking models prepend
 * to their actual output.
 */
function stripThinkingAndSpecialTokens(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\|[a-z_]+\|>/g, "")
    .trim();
}

function extractJsonFromText(text: string): Record<string, unknown> {
  // Strip thinking blocks and special tokens first so they don't
  // interfere with JSON extraction (greedy regex would match braces
  // inside thinking content).
  const cleaned = stripThinkingAndSpecialTokens(text);

  // Try parsing the cleaned text directly
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from the text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return (parsePartialJson(match[0]) as Record<string, unknown>) ?? {};
      }
    }
    return {};
  }
}

export const HFT_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();

  const prompt = buildStructuredGenerationPrompt(input);

  const messages: Message[] = [{ role: "user", content: prompt }];

  const formattedPrompt = generateText.tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

  const streamer = createTextStreamer(generateText.tokenizer, onProgress, TextStreamer);
  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  let results = await generateText(formattedPrompt, {
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    return_full_text: false,
    streamer,
    stopping_criteria: [stopping_criteria],
  });

  if (!Array.isArray(results)) {
    results = [results];
  }

  const responseText = extractGeneratedText(
    (results[0] as TextGenerationOutput[number])?.generated_text
  ).trim();

  const object = extractJsonFromText(responseText);
  return { object };
};

export const HFT_StructuredGeneration_Stream: AiProviderStreamFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();

  const prompt = buildStructuredGenerationPrompt(input);

  const messages: Message[] = [{ role: "user", content: prompt }];

  const formattedPrompt = generateText.tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

  const queue = createStreamEventQueue<StreamEvent<StructuredGenerationTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue, TextStreamer);
  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  let fullText = "";
  // Incrementally maintain cleaned text to avoid O(n²) full-string regex on every token.
  // Use a simple state machine to skip <think>...</think> blocks and strip special
  // tokens only from the delta received, not from the entire accumulated string.
  let cleanedText = "";
  let inThinkBlock = false;
  let jsonStart = -1; // index into cleanedText where the first '{' was found

  const originalPush = queue.push;
  queue.push = (event: StreamEvent<StructuredGenerationTaskOutput>) => {
    if (event.type === "text-delta" && "textDelta" in event) {
      const delta = event.textDelta as string;
      fullText += delta;

      // Process the delta through the state machine to update cleanedText
      let remaining = delta;
      while (remaining.length > 0) {
        if (inThinkBlock) {
          const closeIdx = remaining.indexOf("</think>");
          if (closeIdx !== -1) {
            inThinkBlock = false;
            remaining = remaining.slice(closeIdx + "</think>".length);
          } else {
            remaining = ""; // still inside think block; discard rest of delta
          }
        } else {
          const openIdx = remaining.indexOf("<think>");
          if (openIdx !== -1) {
            cleanedText += remaining.slice(0, openIdx).replace(/<\|[a-z_]+\|>/g, "");
            inThinkBlock = true;
            remaining = remaining.slice(openIdx + "<think>".length);
          } else {
            cleanedText += remaining.replace(/<\|[a-z_]+\|>/g, "");
            remaining = "";
          }
        }
      }

      // Locate the start of the JSON object once and reuse that index
      if (jsonStart === -1) {
        jsonStart = cleanedText.indexOf("{");
      }
      if (jsonStart !== -1) {
        const partial = parsePartialJson(cleanedText.slice(jsonStart));
        if (partial !== undefined) {
          originalPush({
            type: "object-delta",
            port: "object",
            objectDelta: partial,
          } as StreamEvent<StructuredGenerationTaskOutput>);
          return;
        }
      }
    }
    originalPush(event);
  };

  const pipelinePromise = generateText(formattedPrompt, {
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    return_full_text: false,
    streamer,
    stopping_criteria: [stopping_criteria],
  }).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;

  const object = extractJsonFromText(fullText);
  yield { type: "finish", data: { object } as StructuredGenerationTaskOutput };
};
