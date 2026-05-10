// @ts-nocheck — Phase 5j: legacy AiProvider contract assertion. Rewrite during Phase 9 for capability-set dispatch.
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceFixture } from "../types";
import { itExpectFail } from "../../itExpectFail";

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /abort/i.test(e.message ?? "");
}

export function signalHonoringBlock(
  opts: AiProviderConformanceOpts,
  fixture: ConformanceFixture
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itNonStreaming = expectFails.has("signal.nonStreaming") ? itExpectFail : it;
  const skipMid = !opts.capabilities.abortMidStream;
  const itMidStream = expectFails.has("signal.midStream") ? itExpectFail : it;

  describe.skipIf(!opts.models.textGeneration)("Signal honoring", () => {
    itNonStreaming(
      "non-streaming runFn rejects with AbortError when aborted before invocation",
      async () => {
        const registry = getAiProviderRegistry();
        const repo = getGlobalModelRepository();
        const model = await repo.findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        const runFn = registry.getDirectRunFn(model!.provider, "TextGenerationTask");
        const ac = new AbortController();
        ac.abort();

        let caught: unknown;
        try {
          await runFn(
            { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
            model!,
            () => {},
            ac.signal,
            undefined,
            undefined
          );
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeDefined();
        expect(isAbortError(caught)).toBe(true);
      },
      opts.timeout
    );

    if (!skipMid) {
      itMidStream(
        "streaming iterator terminates within abortGraceMs * 4 when aborted mid-stream",
        async () => {
          const registry = getAiProviderRegistry();
          const repo = getGlobalModelRepository();
          const model = await repo.findByName(opts.models.textGeneration!);
          expect(model).toBeDefined();
          const streamFn = registry.getStreamFn(model!.provider, "TextGenerationTask");
          if (!streamFn) return; // capability mismatch — covered by capabilityHonesty
          const ac = new AbortController();
          const start = Date.now();
          setTimeout(() => ac.abort(), fixture.abortGraceMs);

          try {
            for await (const _ev of streamFn(
              { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
              model!,
              ac.signal,
              undefined,
              undefined
            )) {
              void _ev;
            }
          } catch (err) {
            if (!isAbortError(err)) throw err;
          }
          const elapsed = Date.now() - start;
          expect(elapsed).toBeLessThan(fixture.abortGraceMs * 4 + 2000);
        },
        opts.timeout
      );
    }
  });
}
