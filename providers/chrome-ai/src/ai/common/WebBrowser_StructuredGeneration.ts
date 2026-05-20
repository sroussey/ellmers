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
import type { JsonSchema, SchemaNode } from "@workglow/util/schema";
import { compileSchema } from "@workglow/util/schema";
import { parsePartialJson } from "@workglow/util/worker";

import { createDownloadMonitor, ensureAvailable, getApi } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";
import {
  deleteChromeSession,
  dropChromeSessionEntry,
  getChromeSession,
  setChromeSession,
} from "./WebBrowser_Sessions";

/**
 * Stable fingerprint of an `outputSchema` value, used to decide whether a
 * cached Chrome session can be reused. The schema is canonicalised by
 * sorting object keys before stringification so that semantically-equal
 * schemas with differently-ordered properties produce the same fingerprint.
 *
 * Implementation note: we intentionally do not hash this. A medium-length
 * JSON string is fine as a cache key — the cache lives in-memory, scoped
 * to a session id, and turn-over is low.
 */
function schemaFingerprint(schema: object): string {
  return canonicalStringify(schema);
}

/**
 * Recursively sorts object keys so `JSON.stringify` produces a stable
 * representation independent of insertion order. Arrays preserve order
 * (semantically meaningful in JSON Schema for e.g. `oneOf`/`enum`).
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(",")}}`;
}

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
 * ## Session reuse
 *
 * When `sessionId` is provided we cache the underlying `LanguageModel`
 * keyed by it, mirroring `WebBrowser_Chat`. Reuse is gated on:
 *  - watermark match: `messageCount` of the cached entry equals the
 *    pre-turn message count (0 for the first turn).
 *  - schema match: same `schemaFingerprint` (Chrome's `responseConstraint`
 *    state is bound to whatever schema was first prompted; mixing schemas
 *    on a reused session is undefined behavior, so we rebuild).
 *
 * ## Validation
 *
 * Chrome's `responseConstraint` is best-effort, not a hard guarantee.
 * After streaming we validate both that the final accumulated text parses
 * as JSON *and* that the parsed object satisfies `outputSchema`. Failures
 * raise {@link PermanentJobError} — `StructuredGenerationTask` runs us
 * inside a retry loop that catches per-attempt errors, so throwing here
 * is the correct way to mark this attempt failed without misleading
 * downstream consumers with a `finish` carrying garbage.
 */
export const WebBrowser_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit, outputSchema, sessionId) => {
  const factory = getApi(
    "LanguageModel",
    typeof LanguageModel !== "undefined" ? LanguageModel : undefined
  );
  await ensureAvailable("LanguageModel", factory);

  const schema = (input.outputSchema ?? outputSchema) as object | undefined;
  if (!schema) {
    throw new PermanentJobError("WebBrowser_StructuredGeneration: outputSchema is required");
  }

  // Compile validator up-front so a bad schema fails fast (cheap, ahead of
  // any provider work). Re-thrown as PermanentJobError so the surrounding
  // retry loop doesn't waste attempts on a malformed schema.
  let validator: SchemaNode;
  try {
    validator = compileSchema(schema as JsonSchema);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PermanentJobError(`WebBrowser_StructuredGeneration: invalid outputSchema — ${msg}`);
  }

  const fingerprint = schemaFingerprint(schema);

  // StructuredGeneration has no message history of its own — successive
  // calls with the same `sessionId` are independent prompts. We reuse the
  // cached session purely to amortise the cost of `LanguageModel.create()`,
  // gating only on schema fingerprint. The watermark we record is a
  // monotonic call counter so existing fingerprint-aware cache consumers
  // (and future evolution toward true multi-turn structured-gen) keep a
  // consistent shape with `WebBrowser_Chat`.
  let cached = sessionId ? getChromeSession(sessionId) : undefined;
  if (sessionId !== undefined && cached && cached.schemaFingerprint !== fingerprint) {
    deleteChromeSession(sessionId);
    cached = undefined;
  }
  const priorMessageCount = cached?.messageCount ?? 0;

  const usedCachedSession = cached !== undefined;
  let session: LanguageModel;
  if (cached) {
    session = cached.session;
  } else {
    session = await factory.create({
      signal,
      temperature: input.temperature ?? undefined,
      monitor: createDownloadMonitor(emit),
    });
  }

  let cacheWritten = false;
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

    // Validate the *final* output. `responseConstraint` is best-effort on
    // Chrome — if the model produces an unparseable continuation or a
    // shape mismatch, we surface a permanent (per-attempt) error rather
    // than fabricate a `{}` result that downstream code can't distinguish
    // from a legitimate empty object.
    let finalObject: Record<string, unknown>;
    try {
      finalObject = JSON.parse(accumulatedJson) as Record<string, unknown>;
    } catch {
      const partial = parsePartialJson(accumulatedJson);
      if (partial === undefined) {
        throw new PermanentJobError("Chrome AI returned unparseable JSON");
      }
      finalObject = partial as Record<string, unknown>;
    }

    const validation = validator.validate(finalObject);
    if (!validation.valid) {
      const firstError = validation.errors[0];
      const detail = firstError?.message ?? "unknown validation error";
      throw new PermanentJobError(`Chrome AI output failed schema validation: ${detail}`);
    }

    if (sessionId !== undefined) {
      // Ownership of `session` transfers to the cache; the provider's
      // `disposeSession` reclaims it at end of run.
      setChromeSession(sessionId, {
        session,
        messageCount: priorMessageCount + 1,
        schemaFingerprint: fingerprint,
      });
      cacheWritten = true;
    }
    emit({
      type: "finish",
      data: { object: finalObject } as StructuredGenerationTaskOutput,
    });
  } finally {
    // Mirror WebBrowser_Chat's cache-poison handling. If we threw before
    // writing the cache entry and we reused a cached session, the cache
    // entry is now poisoned (partial state); drop it (only if it still
    // points at our handle, to avoid trampling a replacement) and destroy.
    if (!cacheWritten) {
      if (sessionId !== undefined && usedCachedSession) {
        dropChromeSessionEntry(sessionId, session);
      }
      try {
        session.destroy();
      } catch {
        // best-effort
      }
    }
  }
};
