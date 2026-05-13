/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStandardKbStrategy, getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import type { ModelRecord } from "@workglow/ai";
import { createKnowledgeBase } from "@workglow/knowledge-base";
import { uuid4 } from "@workglow/util";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Tests for the first-stage candidate-pool sizing in
 * `createStandardKbStrategy` rerank mode. The pool size is
 * `max(topK * firstStageMultiplier, firstStageMinimum)`; the minimum
 * exists so that a very small `topK` (e.g. 1) does not collapse the
 * reranker's input down to a useless handful of candidates.
 */
const TEST_PROVIDER = "test-firststage-provider";
const TEST_EMBED_MODEL_ID = "test:firststage:embed";

describe("createStandardKbStrategy first-stage sizing (rerank mode)", () => {
  beforeAll(async () => {
    const registry = getAiProviderRegistry();
    registry.registerRunFn(TEST_PROVIDER, "TextEmbeddingTask", async (input) => {
      const texts = Array.isArray((input as { text: unknown }).text)
        ? ((input as { text: string[] }).text as string[])
        : [((input as { text: string }).text as string) ?? ""];
      const vectors = texts.map(() => new Float32Array([1, 0, 0]));
      return {
        vector: vectors.length === 1 ? vectors[0] : vectors,
      } as unknown as Record<string, unknown>;
    });

    const modelRepo = getGlobalModelRepository();
    const existing = await modelRepo.findByName(TEST_EMBED_MODEL_ID).catch(() => undefined);
    if (!existing) {
      await modelRepo.addModel({
        model_id: TEST_EMBED_MODEL_ID,
        tasks: ["TextEmbeddingTask"],
        title: "First-stage sizing test embed model",
        description: "Stub embed model for first-stage sizing tests",
        provider: TEST_PROVIDER,
        provider_config: { native_dimensions: 3 },
        metadata: {},
      } as ModelRecord);
    }
  });

  /**
   * Set up a rerank-mode KB and spy on the first-stage retrieval call so
   * we can assert exactly what `topK` the strategy hands down to it.
   * Heuristic-reranker path (no `rerankerModel`) is used because we only
   * care about the first-stage `topK`, not the reranker output.
   */
  async function captureFirstStageTopK(
    strategyOptions: Parameters<typeof createStandardKbStrategy>[0],
    searchTopK: number
  ): Promise<number> {
    const kb = await createKnowledgeBase({
      name: `kb-first-stage-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
      docEmbeddingModel: TEST_EMBED_MODEL_ID,
      searchMode: "rerank",
    });
    kb.setAiStrategy(createStandardKbStrategy(strategyOptions));

    // Spy on whichever first-stage method the strategy will pick. Both
    // are stubbed to return [] so the rerank path short-circuits and we
    // don't have to seed real chunks.
    const hybridSpy = vi
      .spyOn(kb, "hybridSearch" as never)
      .mockResolvedValue([] as never);
    const similaritySpy = vi
      .spyOn(kb, "similaritySearch" as never)
      .mockResolvedValue([] as never);

    await kb.search("hi", { topK: searchTopK });

    // Exactly one of the spies should fire (mutually exclusive branches
    // in the strategy: hybrid if supportsHybridSearch, else similarity).
    const calls = [...hybridSpy.mock.calls, ...similaritySpy.mock.calls];
    expect(calls.length).toBe(1);
    const opts = calls[0][1] as { topK: number };
    return opts.topK;
  }

  it("topK=1, multiplier defaults to 5, minimum defaults to 20 → first-stage topK=20", async () => {
    const firstStage = await captureFirstStageTopK(undefined, 1);
    expect(firstStage).toBe(20);
  });

  it("topK=10, multiplier defaults to 5 → first-stage topK=50 (above minimum)", async () => {
    const firstStage = await captureFirstStageTopK(undefined, 10);
    expect(firstStage).toBe(50);
  });

  it("topK=2, multiplier=1, firstStageMinimum=20 → first-stage topK=20 (minimum wins)", async () => {
    const firstStage = await captureFirstStageTopK(
      { firstStageMultiplier: 1, firstStageMinimum: 20 },
      2
    );
    expect(firstStage).toBe(20);
  });
});
