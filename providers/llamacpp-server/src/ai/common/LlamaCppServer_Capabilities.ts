/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { LLAMACPP_SERVER_CAPABILITY_SETS } from "./LlamaCppServer_CapabilitySets";

export const LLAMACPP_SERVER_RUN_FN_SPECS = LLAMACPP_SERVER_CAPABILITY_SETS.map((serves) => ({
  serves,
}));

export function llamaCppServerWorkerRunFnSpecs(): readonly {
  readonly serves: readonly Capability[];
}[] {
  return LLAMACPP_SERVER_RUN_FN_SPECS;
}

const EMBEDDING_NAME_PATTERNS: readonly RegExp[] = [
  /embed/i,
  /^nomic-embed/i,
  /^mxbai-embed/i,
  /^all-minilm/i,
  /^snowflake-arctic-embed/i,
  /^bge-/i,
  /^gte-/i,
];

type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference. Like Ollama, default-permissive: a
 * mis-routed model surfaces as a runtime HTTP error rather than a missed
 * capability.
 *
 *   1. `provider_config.native_dimensions` set → embedding model
 *   2. Filename matches an embedding pattern → embedding model
 *   3. Filename matches llava / bakllava / -vision → vision-capable text-gen
 *   4. Any other name → full text-gen + rewriter + summary + tool-use + meta
 *   5. No id at all → declared caps OR baseline meta-ops
 */
export function inferLlamaCppServerCapabilities(model: CapabilityHints): readonly Capability[] {
  const pc = model.provider_config as
    | { model_path?: string; model_name?: string; native_dimensions?: number }
    | undefined;
  const id = String(pc?.model_path ?? pc?.model_name ?? model.model_id ?? "");
  const base = (id.split("/").pop() ?? "").toLowerCase();

  if (typeof pc?.native_dimensions === "number") {
    return ["text.embedding", "model.info", "model.search"];
  }
  if (EMBEDDING_NAME_PATTERNS.some((rx) => rx.test(base))) {
    return ["text.embedding", "model.info", "model.search"];
  }
  if (/llava|bakllava|-vision\b/.test(base)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "vision-input",
      "model.info",
      "model.search",
    ];
  }
  if (base.length > 0) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "model.info",
      "model.search",
    ];
  }
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;
  return ["model.info", "model.search"];
}
