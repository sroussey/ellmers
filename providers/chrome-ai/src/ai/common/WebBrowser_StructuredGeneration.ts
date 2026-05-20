/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
} from "@workglow/ai";
import { parsePartialJson } from "@workglow/util/worker";

import { createDownloadMonitor, ensureAvailable, getApi } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

/**
 * Streaming run-fn for `["text.generation", "json-mode"]`.
 *
 * Chrome's Prompt API constrains output to a JSON Schema via the
 * `responseConstraint` option on `prompt()` / `promptStreaming()`. The
 * model still streams raw text — Chrome guarantees the final result will
 * parse and validate against the constraint, but the streaming snapshots
 * are partial JSON. We emit progressively-complete partial snapshots as
 * `object-delta` events on the `object` port, then a `finish` event whose
 * `data.object` carries the fully parsed result, per the structured-
 * generation streaming-convention exception (see CLAUDE.md).
 *
 * `omitResponseConstraintInput` is set to `true`: the schema is already
 * enforced via the runtime constraint, so re-sending it as a prompt
 * preamble would waste context budget.
 */
export const WebBrowser_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit, outputSchema) => {
  const factory = getApi(
    "LanguageModel",
    typeof LanguageModel !== "undefined" ? LanguageModel : undefined
  );
  await ensureAvailable("LanguageModel", factory);

  const schema = (input.outputSchema ?? outputSchema) as object | undefined;
  if (!schema) {
    throw new Error("WebBrowser_StructuredGeneration: outputSchema is required");
  }

  const session = await factory.create({
    signal,
    temperature: input.temperature ?? undefined,
    monitor: createDownloadMonitor(emit),
  });
  try {
    const stream = session.promptStreaming(input.prompt, {
      signal,
      responseConstraint: schema as Record<string, unknown>,
      omitResponseConstraintInput: true,
    });

    let accumulatedJson = "";
    let previousSnapshot = "";
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Chrome's streaming surface emits progressive full-text snapshots,
        // not deltas. Diff against the previous snapshot so the accumulated
        // JSON grows monotonically; on the (rare) replacement case, reset.
        if (value.startsWith(previousSnapshot)) {
          accumulatedJson += value.slice(previousSnapshot.length);
        } else {
          accumulatedJson = value;
        }
        previousSnapshot = value;
        const partial = parsePartialJson(accumulatedJson);
        if (partial !== undefined) {
          emit({ type: "object-delta", port: "object", objectDelta: partial });
        }
      }
    } finally {
      reader.releaseLock();
    }

    let finalObject: Record<string, unknown>;
    try {
      finalObject = JSON.parse(accumulatedJson) as Record<string, unknown>;
    } catch {
      finalObject = (parsePartialJson(accumulatedJson) ?? {}) as Record<string, unknown>;
    }
    emit({
      type: "finish",
      data: { object: finalObject } as StructuredGenerationTaskOutput,
    });
  } finally {
    session.destroy();
  }
};
