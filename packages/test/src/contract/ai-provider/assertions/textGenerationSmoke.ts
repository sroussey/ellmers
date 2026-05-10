// @ts-nocheck — Phase 5j: legacy AiProvider contract assertion. Rewrite during Phase 9 for capability-set dispatch.
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository, textGeneration } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceFixture } from "../types";

export function textGenerationSmokeBlock(
  opts: AiProviderConformanceOpts,
  fixture: ConformanceFixture
): void {
  describe.skipIf(!opts.models.textGeneration)("TextGeneration smoke", () => {
    it(
      "non-streaming returns non-empty text",
      async () => {
        const result = await textGeneration({
          model: opts.models.textGeneration!,
          prompt: fixture.textPrompt,
          maxTokens: fixture.maxTokens,
        });
        expect(result).toBeDefined();
        expect(typeof result.text).toBe("string");
        expect(result.text.length).toBeGreaterThan(0);
      },
      opts.timeout
    );

    it.skipIf(!opts.capabilities.streaming)(
      "streaming yields ≥1 text-delta and exactly one finish, with no event after finish",
      async () => {
        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        const streamFn = registry.getStreamFn(model!.provider, "TextGenerationTask");
        expect(streamFn).toBeDefined();

        let textDeltaCount = 0;
        let finishCount = 0;
        let sawEventAfterFinish = false;
        for await (const ev of streamFn!(
          { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
          model!,
          new AbortController().signal,
          undefined,
          undefined
        )) {
          if (finishCount > 0) {
            sawEventAfterFinish = true;
          }
          const e = ev as { type: string };
          if (e.type === "text-delta") textDeltaCount += 1;
          if (e.type === "finish") finishCount += 1;
        }

        expect(textDeltaCount).toBeGreaterThanOrEqual(1);
        expect(finishCount).toBe(1);
        expect(sawEventAfterFinish).toBe(false);
      },
      opts.timeout
    );
  });
}
