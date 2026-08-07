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
import { PermanentJobError } from "@workglow/job-queue";
import type { JsonSchema } from "@workglow/util/schema";
import { compileSchema } from "@workglow/util/schema";
import { createPartialJsonStream } from "@workglow/util/worker";

import {
  createDownloadMonitor,
  ensureAvailable,
  getApi,
  getChromeGlobal,
} from "./WebBrowser_ChromeHelpers";
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
 *
 * `temperature` is `@deprecated` for non-extension contexts in the current
 * Chrome spec and silently ignored on the open web. Passed through anyway
 * so extension callers still get the knob.
 *
 * ## Validation
 *
 * Chrome's `responseConstraint` is best-effort, not a hard guarantee.
 * We still fail fast on malformed schemas by compiling them up front, but parse/shape mismatches are
 * surfaced via the `finish` payload so `StructuredGenerationTask` can apply
 * its normal retry/repair loop around the provider response.
 */
export const WebBrowser_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit, outputSchema) => {
  const factory = getApi("LanguageModel", getChromeGlobal<typeof LanguageModel>("LanguageModel"));
  await ensureAvailable("LanguageModel", factory);

  const schema = (input.outputSchema ?? outputSchema) as object | undefined;
  if (!schema) {
    throw new PermanentJobError("WebBrowser_StructuredGeneration: outputSchema is required");
  }

  // Compile the schema up-front so a bad schema fails fast (cheap, ahead of
  // any provider work). We intentionally don't retain the validator here:
  // `StructuredGenerationTask` re-validates `finish.data.object` downstream
  // and drives the retry/repair loop from that result.
  try {
    compileSchema(schema as JsonSchema);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PermanentJobError(`WebBrowser_StructuredGeneration: invalid outputSchema — ${msg}`);
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

    let json = createPartialJsonStream();
    let previousSnapshot = "";
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Chrome's streaming surface emits progressive full-text snapshots,
        // not deltas. Feed the parser only the newly-appended tail; on the
        // (rare) replacement case, restart it on the replacement text.
        let partial: Record<string, unknown> | undefined;
        if (value.startsWith(previousSnapshot)) {
          partial = json.push(value.slice(previousSnapshot.length));
        } else {
          json = createPartialJsonStream();
          partial = json.push(value);
        }
        previousSnapshot = value;
        if (partial !== undefined) {
          emit({ type: "object-delta", port: "object", objectDelta: partial });
        }
      }
    } finally {
      reader.releaseLock();
    }

    emit({
      type: "finish",
      data: { object: json.finish() } as StructuredGenerationTaskOutput,
    });
  } finally {
    try {
      session.destroy();
    } catch {
      // best-effort
    }
  }
};
