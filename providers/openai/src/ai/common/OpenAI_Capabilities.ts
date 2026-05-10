/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";

/**
 * Closed list of capability-set specs the OpenAI provider serves. Used by
 * the main-thread provider shells when registering worker-mode proxies (the
 * actual runFns live in {@link OPENAI_RUN_FNS} on the worker side, but the
 * main thread still needs to know which `serves` sets to register so the
 * dispatcher can route requests to the worker proxy).
 *
 * Must stay in sync with {@link OPENAI_RUN_FNS} in `OpenAI_JobRunFns(.browser).ts`.
 */
const OPENAI_RUN_FN_SPECS: readonly { readonly serves: readonly Capability[] }[] = [
  { serves: ["text.generation"] },
  { serves: ["text.generation", "tool-use"] },
  { serves: ["text.generation", "json-mode"] },
  { serves: ["text.rewriter"] },
  { serves: ["text.summary"] },
  { serves: ["text.embedding"] },
  { serves: ["image.generation"] },
  { serves: ["image.editing"] },
  { serves: ["model.count-tokens"] },
  { serves: ["provider.model-search"] },
  { serves: ["provider.model-info"] },
];

export function openAiWorkerRunFnSpecs(): readonly { readonly serves: readonly Capability[] }[] {
  return OPENAI_RUN_FN_SPECS;
}

/**
 * Shape used by the model-name regexes — `model_id` is required, the rest
 * is loosely-typed metadata only used to opportunistically widen the
 * inferred capability set.
 */
type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference for an OpenAI {@link ModelRecord}. Pattern-
 * matches the canonical OpenAI model id strings (and the `provider_config.
 * model_name` if present) to a closed set of {@link Capability}s. Falls back
 * to the model's stored `capabilities` array (or a baseline of search +
 * info) when no pattern matches.
 *
 * Main-thread method only — workers do not run capability inference.
 */
export function inferOpenAiCapabilities(model: CapabilityHints): readonly Capability[] {
  const id = String(
    model.model_id ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );

  // Embedding models — text-embedding-3-{small,large}, text-embedding-ada-002.
  if (/^text-embedding/i.test(id)) {
    return [
      "text.embedding",
      "model.count-tokens",
      "provider.model-info",
      "provider.model-search",
    ];
  }

  // Image models — DALL-E and gpt-image families.
  if (/^dall-e/i.test(id)) {
    // DALL-E 2/3 do NOT support edit consistently — gpt-image-* does. Cover
    // generation only here; the gpt-image branch below adds editing.
    return ["image.generation", "provider.model-info", "provider.model-search"];
  }
  if (/^gpt-image/i.test(id)) {
    return [
      "image.generation",
      "image.editing",
      "provider.model-info",
      "provider.model-search",
    ];
  }

  // Chat / reasoning models — gpt-3.5/4/4o/5/...; o1/o3/o4 reasoning families.
  // GPT-4o and gpt-4-vision-* additionally accept image inputs.
  if (/^gpt-/i.test(id) || /^o[134]/i.test(id)) {
    const caps: Capability[] = [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "model.count-tokens",
      "provider.model-info",
      "provider.model-search",
    ];
    if (/gpt-4o|gpt-4\.1|gpt-5|gpt-4-vision|gpt-4-turbo/i.test(id)) {
      caps.push("vision-input");
    }
    return caps;
  }

  // Unknown model — fall back to whatever the record declared, or just
  // expose the meta-ops so the model can still be searched / inspected.
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;
  return ["provider.model-search", "provider.model-info"];
}
