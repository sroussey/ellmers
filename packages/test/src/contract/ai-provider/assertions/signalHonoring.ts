/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceFixture } from "../types";

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
  const itNonStreaming = expectFails.has("signal.nonStreaming") ? it.fails : it;
  const itMidStream = !opts.capabilities.abortMidStream
    ? it.skip
    : expectFails.has("signal.midStream")
      ? it.fails
      : it;

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

        await expect(
          runFn(
            { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
            model!,
            () => {},
            ac.signal,
            undefined,
            undefined
          )
        ).rejects.toSatisfy(isAbortError);
      },
      opts.timeout
    );

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

        const events: unknown[] = [];
        try {
          for await (const ev of streamFn(
            { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
            model!,
            ac.signal,
            undefined,
            undefined
          )) {
            events.push(ev);
          }
        } catch (err) {
          if (!isAbortError(err)) throw err;
        }
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(fixture.abortGraceMs * 4 + 2000);
      },
      opts.timeout
    );
  });
}
