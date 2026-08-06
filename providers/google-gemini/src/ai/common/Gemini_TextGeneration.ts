/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import { getLogger } from "@workglow/util/worker";
import { buildGeminiPrefixedContents } from "./Gemini_CacheCheckpoint";
import { generateGeminiStreamWithCacheFallback } from "./Gemini_CachedContentFallback";
import { evictIfStaleGeminiCachedContent, getGeminiCachedContent } from "./Gemini_CacheStore";
import { createGeminiClient, getModelName, resolveThinkingConfig } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { emitGeminiRefusal, geminiRefusalCategory } from "./Gemini_Refusal";
import { buildGeminiContents } from "./Gemini_ToolCalling";
import { mapGeminiUsage } from "./Gemini_Usage";

interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/**
 * Maps the canonical sampling params onto Gemini's `generationConfig`, only
 * setting fields that are defined so callers that omit a param keep the
 * provider's default (matching the OpenAI/Anthropic adapters).
 */
function buildGenerationConfig(input: TextGenerationTaskInput): GeminiGenerationConfig {
  const config: GeminiGenerationConfig = {};
  if (input.maxTokens !== undefined) config.maxOutputTokens = input.maxTokens;
  if (input.temperature !== undefined) config.temperature = input.temperature;
  if (input.topP !== undefined) config.topP = input.topP;
  if (input.frequencyPenalty !== undefined) config.frequencyPenalty = input.frequencyPenalty;
  if (input.presencePenalty !== undefined) config.presencePenalty = input.presencePenalty;
  return config;
}

/**
 * Inputs that the unified `["text.generation"]` runFn handles. Both
 * {@link TextGenerationTask} and {@link AiChatTask} declare
 * `requires: ["text.generation"]`, so the capability dispatcher routes both
 * here. AiChatTask supplies a populated `messages` array; TextGenerationTask
 * (and other simple prompt callers) supply a `prompt` string only.
 */
interface UnifiedTextGenerationInput extends TextGenerationTaskInput {
  readonly messages?: readonly unknown[];
  readonly systemPrompt?: string;
}

/**
 * Streaming run-fn for the `["text.generation"]` capability. Used by both
 * {@link TextGenerationTask} (prompt-only input) and {@link AiChatTask}
 * (full conversation history). Yields `text-delta` events on the `text` port
 * and a final empty `finish` event per the streaming convention (consumer
 * accumulates).
 *
 * Discriminates on `Array.isArray(input.messages) && input.messages.length > 0`
 * to choose the chat vs. prompt path — safe because AiChatTask always provides
 * `messages` and TextGenerationTask never does.
 */
export const Gemini_TextGeneration_Stream: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionContext) => {
  const logger = getLogger();
  const timerLabel = `gemini:TextGeneration:${getModelName(model)}`;
  logger.time(timerLabel, { model: getModelName(model) });
  try {
    signal?.throwIfAborted?.();
    const unified = input as UnifiedTextGenerationInput;
    const hasMessages = Array.isArray(unified.messages) && unified.messages.length > 0;

    const ai = await createGeminiClient(model);

    // Checkpoint consumption. Preferred path: reference the warm-up's explicit
    // CachedContent and send only the tail. The API rejects requests that set
    // systemInstruction alongside cachedContent, so the cache handle is only
    // usable when the call carries no system prompt of its own (or the same
    // one the cache was created with) and when the cache was not created with
    // tool declarations. Otherwise — including after the cache's TTL expiry —
    // replay the prefix content inline; implicit caching still applies there.
    const prefix = sessionContext?.prefix;
    // For an ownedSession consumer (a checkpoint-seeded AiChatTask), sessionId
    // is the chat's own session id; the warm-up registered the CachedContent
    // under the seed checkpoint id, so resolve the cache lookup through it.
    const checkpointId = sessionContext?.seedCheckpointId ?? sessionContext?.sessionId;
    const cachedEntry = checkpointId ? getGeminiCachedContent(checkpointId) : undefined;
    const ownSystemPrompt = hasMessages ? unified.systemPrompt || undefined : undefined;
    let useCachedContent =
      prefix !== undefined &&
      cachedEntry !== undefined &&
      (prefix.tools === undefined || prefix.tools.length === 0) &&
      (ownSystemPrompt === undefined || ownSystemPrompt === cachedEntry.systemPrompt);
    if (cachedEntry !== undefined && prefix?.tools !== undefined && prefix.tools.length > 0) {
      // A CachedContent warmed WITH tools keeps its function declarations
      // active on every request that references it, and this text-only
      // consumer would silently drop any functionCall parts the model then
      // returns — so tools-warmed checkpoints replay the prefix inline.
      logger.debug("Gemini cached content warmed with tools; text-only consumer replaying inline");
    }

    // Proactive stale eviction — drop a nearly-expired runtime-local entry up
    // front and replay inline instead of eating a reactive NOT_FOUND.
    if (
      useCachedContent &&
      cachedEntry &&
      checkpointId &&
      evictIfStaleGeminiCachedContent(checkpointId, cachedEntry)
    ) {
      useCachedContent = false;
    }

    // Thinking is opt-in here (no default budget); when a budget is configured,
    // the output cap is padded so reasoning can't starve the visible answer.
    const { thinkingConfig, maxOutputTokens } = resolveThinkingConfig(model, input.maxTokens);

    /** Build the tail-only request that references the CachedContent handle. */
    const buildCachedRequest = (): Record<string, unknown> => {
      const contents = hasMessages
        ? buildGeminiContents(
            unified.messages as Parameters<typeof buildGeminiContents>[0],
            unified.prompt ?? ""
          )
        : [{ role: "user", parts: [{ text: input.prompt }] }];
      return {
        model: getModelName(model),
        contents,
        config: {
          abortSignal: signal ?? undefined,
          systemInstruction: undefined,
          cachedContent: cachedEntry!.name,
          ...buildGenerationConfig(input),
          maxOutputTokens,
          thinkingConfig,
        },
      };
    };

    /** Build the full inline-replay request (prefix messages + tail). */
    const buildInlineReplayRequest = (): Record<string, unknown> => {
      let contents: any[];
      let systemInstruction: string | undefined;
      if (prefix) {
        contents = buildGeminiPrefixedContents(
          prefix,
          hasMessages ? (unified.messages as Parameters<typeof buildGeminiContents>[0]) : undefined,
          unified.prompt
        );
        systemInstruction = ownSystemPrompt ?? prefix.systemPrompt;
      } else {
        contents = hasMessages
          ? buildGeminiContents(
              unified.messages as Parameters<typeof buildGeminiContents>[0],
              unified.prompt ?? ""
            )
          : [{ role: "user", parts: [{ text: input.prompt }] }];
        systemInstruction = ownSystemPrompt;
      }
      return {
        model: getModelName(model),
        contents,
        config: {
          abortSignal: signal ?? undefined,
          systemInstruction,
          ...buildGenerationConfig(input),
          maxOutputTokens,
          thinkingConfig,
        },
      };
    };

    const result = await generateGeminiStreamWithCacheFallback({
      useCachedContent,
      checkpointId,
      buildRequest: (useCached) => (useCached ? buildCachedRequest() : buildInlineReplayRequest()),
      runStream: (request) =>
        ai.models.generateContentStream(
          request as unknown as Parameters<typeof ai.models.generateContentStream>[0]
        ),
    });

    let refusalCategory: string | undefined;
    let lastUsageMetadata: unknown;
    for await (const chunk of result) {
      // `chunk.text` concatenates answer text and already skips thought parts.
      const text = chunk.text;
      if (text) {
        emit({ type: "text-delta", port: "text", textDelta: text });
      }
      lastUsageMetadata = chunk.usageMetadata ?? lastUsageMetadata;
      refusalCategory = refusalCategory ?? geminiRefusalCategory(chunk);
    }
    emitGeminiRefusal(emit, refusalCategory);

    emit({
      type: "finish",
      data: {} as TextGenerationTaskOutput,
      usage: mapGeminiUsage(lastUsageMetadata),
    });
  } finally {
    logger.timeEnd(timerLabel, { model: getModelName(model) });
  }
};
