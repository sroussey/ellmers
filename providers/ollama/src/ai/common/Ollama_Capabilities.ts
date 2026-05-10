/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { OLLAMA_CAPABILITY_SETS } from "./Ollama_CapabilitySets";

/**
 * Closed list of capability-set specs the Ollama provider serves. Derived
 * from {@link OLLAMA_CAPABILITY_SETS} — do not edit here. Used by the
 * main-thread provider shells when registering worker-mode proxies.
 */
export const OLLAMA_RUN_FN_SPECS = OLLAMA_CAPABILITY_SETS.map((serves) => ({ serves }));

export function ollamaWorkerRunFnSpecs(): readonly { readonly serves: readonly Capability[] }[] {
  return OLLAMA_RUN_FN_SPECS;
}

type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/** Known Ollama embedding model name prefixes (or substrings). */
const EMBEDDING_NAME_PATTERNS = [
  /^nomic-embed/i,
  /^mxbai-embed/i,
  /^all-minilm/i,
  /^snowflake-arctic-embed/i,
  /^bge-/i,
  /^gte-/i,
  /(^|[/-])embed(ding)?($|[-:])/i,
];

/**
 * Heuristic capability inference for an Ollama {@link ModelRecord}.
 *
 * Ollama is unusual: users pull arbitrary local models, so the canonical
 * "id-prefix table" approach used by cloud providers is insufficient. The
 * strategy here is:
 *
 *   1. Known-embedding prefixes → text.embedding + meta-ops
 *   2. Vision suffixes (`llava*`, `bakllava*`, `*-vision`) → full text-gen + vision-input
 *   3. Any other id → text-generation default (full text caps + tool-use + meta-ops)
 *   4. Unknown + no caps + no match → declared caps OR baseline meta-ops
 *
 * The default-permissive policy is safe because Ollama dispatch always
 * routes via the local server: a model that doesn't actually support
 * `chat`/tools will surface that as a runtime API error, not a capability
 * miss.
 */
export function inferOllamaCapabilities(model: CapabilityHints): readonly Capability[] {
  const id = String(
    model.model_id ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );

  // Strip Ollama tag suffix (e.g. "llama3:8b" → "llama3") before prefix-matching.
  const baseName = id.split(":")[0];

  // Embedding models.
  if (EMBEDDING_NAME_PATTERNS.some((rx) => rx.test(baseName))) {
    return ["text.embedding", "provider.model-info", "provider.model-search"];
  }

  // Vision-capable local models — llava family, bakllava, and `*-vision` tags.
  if (/^llava/i.test(baseName) || /^bakllava/i.test(baseName) || /-vision\b/i.test(baseName)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "vision-input",
      "provider.model-info",
      "provider.model-search",
    ];
  }

  // Default: any other named local model is assumed to be a generative
  // text/chat model. (Cheaper to over-advertise here than to miss: Ollama
  // surfaces unsupported features as runtime errors.)
  if (baseName.length > 0) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "provider.model-info",
      "provider.model-search",
    ];
  }

  // No id at all — fall back to declared or baseline meta-ops.
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;
  return ["provider.model-search", "provider.model-info"];
}
