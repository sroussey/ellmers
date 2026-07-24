/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from "vitest";

// Plan C — Gemini NOT_FOUND matcher two-tier — needs
// `providers/google-gemini/src/ai/common/Gemini_CachedContentFallback.ts`, which
// only exists on the `ai-provider-cache-checkpoints` feature branch. Once the
// checkpoint plumbing lands on `main` this suite must:
//
//   1. Assert the structured NOT_FOUND matcher consults `err.details` /
//      `err.error.details` for a `ResourceInfo`-shaped entry, treating a
//      `cachedContents/…` prefix as a positive and any other prefix (models/,
//      files/, tunedModels/, …) as a negative.
//   2. Confirm the fallback path when the response has no structured details
//      (caller has gated on `useCachedContent && checkpointId`).
//   3. Extend the message-only fallback to accept the reversed clause order and
//      the widened wording (`expired|stale|removed|deleted|no longer exists`)
//      within the `{0,120}` distance.
//   4. Cover the negative cases: model 404 with `ResourceInfo.resourceName =
//      "models/…"`, cache 404 gated at the caller level, and the existing nine
//      message-only negatives that the current matcher already rejects.
//
// Landing this before the fallback file exists on `main` would fail resolution.
describe.skip("TODO — Plan C: Gemini NOT_FOUND matcher two-tier", () => {
  it("cachedContents ResourceInfo → cache-not-found (positive)", () => {
    // See TODO block above.
  });

  it("models/... ResourceInfo → not cache-not-found (negative)", () => {
    // See TODO block above.
  });

  it("structured NOT_FOUND without details, caller-gated → cache-not-found", () => {
    // See TODO block above.
  });

  it("widened message wording within {0,120} distance → cache-not-found", () => {
    // See TODO block above.
  });

  it("existing negative wording set still rejected", () => {
    // See TODO block above.
  });
});
