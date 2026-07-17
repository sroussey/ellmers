/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  ChatMessage,
  CheckpointPrefix,
  ContentBlock,
  ToolDefinition,
} from "@workglow/ai";
import { buildToolDescription } from "@workglow/ai/worker";
import { getLogger } from "@workglow/util/worker";
import { setGeminiCachedContent } from "./Gemini_CacheStore";
import { createGeminiClient, getModelName } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { sanitizeSchemaForGemini } from "./Gemini_Schema";
import { buildGeminiContents } from "./Gemini_ToolCalling";

/** Default TTL for explicit cached content — Gemini bills storage per token-hour. */
const GEMINI_CACHE_TTL = "3600s";

/** Shared Gemini functionDeclarations mapping for tool definitions. */
export function buildGeminiFunctionDeclarations(
  tools: readonly ToolDefinition[]
): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.name,
    description: buildToolDescription(t),
    parameters: sanitizeSchemaForGemini(t.inputSchema as Record<string, unknown>) as any,
  }));
}

/**
 * Compares the function declarations Gemini receives, ignoring declaration
 * order and JSON object-key order.
 */
export function geminiCachedToolsMatch(
  prefixTools: readonly ToolDefinition[],
  inputTools: readonly ToolDefinition[]
): boolean {
  const normalizedPrefix = buildGeminiFunctionDeclarations(prefixTools)
    .map(normalizeGeminiWireDeclaration)
    .sort();
  const normalizedInput = buildGeminiFunctionDeclarations(inputTools)
    .map(normalizeGeminiWireDeclaration)
    .sort();

  return JSON.stringify(normalizedPrefix) === JSON.stringify(normalizedInput);
}

function normalizeGeminiWireDeclaration(declaration: Record<string, unknown>): string {
  return JSON.stringify(normalizeGeminiWireValue(declaration));
}

function normalizeGeminiWireValue(value: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const nested = value[key];
    if (nested === undefined) continue;
    sorted[key] =
      key === "parameters" ? normalizeSchemaValue(nested) : normalizeLiteralValue(nested);
  }
  return sorted;
}

function normalizeSchemaValue(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return normalizeLiteralValue(value);
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested === undefined) continue;
    sorted[key] = normalizeSchemaKeyword(key, nested);
  }
  return sorted;
}

function normalizeSchemaKeyword(key: string, value: unknown): unknown {
  switch (key) {
    case "allOf":
    case "anyOf":
    case "oneOf":
      return normalizeSchemaArray(value, true);
    case "enum":
      return normalizeLiteralArray(value, true);
    case "required":
    case "type":
      return normalizeLiteralArray(value, true);
    case "prefixItems":
      return normalizeSchemaArray(value, false);
    case "items":
      return Array.isArray(value)
        ? normalizeSchemaArray(value, false)
        : normalizeSchemaValue(value);
    case "$defs":
    case "definitions":
    case "dependentSchemas":
    case "patternProperties":
    case "properties":
      return normalizeSchemaMap(value);
    case "dependencies":
      return normalizeDependencies(value);
    case "dependentRequired":
      return normalizeRequiredMap(value);
    case "additionalProperties":
    case "contains":
    case "contentSchema":
    case "else":
    case "if":
    case "not":
    case "propertyNames":
    case "then":
    case "unevaluatedItems":
    case "unevaluatedProperties":
      return normalizeSchemaValue(value);
    default:
      return normalizeLiteralValue(value);
  }
}

function normalizeSchemaArray(value: unknown, unordered: boolean): unknown {
  if (!Array.isArray(value)) return normalizeLiteralValue(value);
  const normalized = value.map(normalizeSchemaValue);
  return unordered ? sortCanonicalValues(normalized) : normalized;
}

function normalizeLiteralArray(value: unknown, unordered: boolean): unknown {
  if (!Array.isArray(value)) return normalizeLiteralValue(value);
  const normalized = value.map(normalizeLiteralValue);
  return unordered ? sortCanonicalValues(normalized) : normalized;
}

function normalizeSchemaMap(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return normalizeLiteralValue(value);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested !== undefined) sorted[key] = normalizeSchemaValue(nested);
  }
  return sorted;
}

function normalizeRequiredMap(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return normalizeLiteralValue(value);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested !== undefined) sorted[key] = normalizeLiteralArray(nested, true);
  }
  return sorted;
}

function normalizeDependencies(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return normalizeLiteralValue(value);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested === undefined) continue;
    sorted[key] = Array.isArray(nested)
      ? normalizeLiteralArray(nested, true)
      : normalizeSchemaValue(nested);
  }
  return sorted;
}

function normalizeLiteralValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeLiteralValue);
  if (value === null || typeof value !== "object") return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested !== undefined) sorted[key] = normalizeLiteralValue(nested);
  }
  return sorted;
}

function sortCanonicalValues(values: unknown[]): unknown[] {
  return values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

/**
 * Builds the `contents` for a checkpoint consumer replaying the prefix inline:
 * prefix messages first, then the caller's tail (its `messages`, or its
 * `prompt` lifted into a user turn — {@link buildGeminiContents} only falls
 * back to `prompt` when the message list is empty).
 */
export function buildGeminiPrefixedContents(
  prefix: CheckpointPrefix,
  messages: ReadonlyArray<ChatMessage> | undefined,
  prompt: unknown
): any[] {
  const tail: ChatMessage[] =
    messages && messages.length > 0 ? [...messages] : promptTailMessages(prompt);
  return buildGeminiContents([...(prefix.messages ?? []), ...tail], "");
}

function promptTailMessages(prompt: unknown): ChatMessage[] {
  if (prompt === undefined || prompt === "") return [];
  if (typeof prompt === "string") {
    return [{ role: "user", content: [{ type: "text", text: prompt }] }];
  }
  if (Array.isArray(prompt)) {
    const blocks = prompt.map((p): ContentBlock => {
      if (typeof p === "string") return { type: "text", text: p };
      return p as ContentBlock;
    });
    return [{ role: "user", content: blocks }];
  }
  return [{ role: "user", content: [{ type: "text", text: String(prompt) }] }];
}

/**
 * Warm-up run-fn for `["cache.checkpoint"]` on Gemini. Creates an explicit
 * server-side CachedContent from the prefix (system prompt + tools + messages)
 * and records its resource name under the checkpoint id, so consumers can
 * reference it and send only their tail.
 *
 * Creation is advisory: explicit caching has a per-model minimum prefix size,
 * so a too-small (or unsupported) prefix degrades to no entry — consumers then
 * replay the registry prefix inline, where Gemini's implicit caching still
 * applies. The consumed cache also expires by TTL, which the inline-replay
 * fallback covers as well.
 */
export const Gemini_CacheCheckpoint_Stream: AiProviderRunFn<
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  GeminiModelConfig
> = async (_input, model, signal, emit, _outputSchema, session) => {
  const checkpointId = session?.sessionId;
  if (!checkpointId) {
    throw new Error(
      "Gemini_CacheCheckpoint: sessionContext.sessionId (checkpoint id) is required."
    );
  }
  const prefix = session?.prefix ?? {};
  const ai = await createGeminiClient(model);

  const contents =
    prefix.messages && prefix.messages.length > 0
      ? buildGeminiContents(prefix.messages, "")
      : [{ role: "user", parts: [{ text: "." }] }];

  try {
    signal?.throwIfAborted?.();
    const cached = await ai.caches.create({
      model: getModelName(model),
      config: {
        contents,
        ...(prefix.systemPrompt ? { systemInstruction: prefix.systemPrompt } : {}),
        ...(prefix.tools && prefix.tools.length > 0
          ? { tools: [{ functionDeclarations: buildGeminiFunctionDeclarations(prefix.tools) }] }
          : {}),
        ttl: GEMINI_CACHE_TTL,
      },
    } as Parameters<typeof ai.caches.create>[0]);
    if (cached?.name) {
      setGeminiCachedContent(checkpointId, {
        name: cached.name,
        model: model!,
        systemPrompt: prefix.systemPrompt,
      });
    }
  } catch (err) {
    getLogger().warn(
      `Gemini cache checkpoint warm-up degraded to inline replay: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  emit({ type: "finish", data: { checkpoint: checkpointId } });
};
