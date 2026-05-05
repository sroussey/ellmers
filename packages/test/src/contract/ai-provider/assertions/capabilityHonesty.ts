/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts } from "../types";

export function capabilityHonestyBlock(opts: AiProviderConformanceOpts): void {
  describe("Capability honesty", () => {
    it.skipIf(opts.capabilities.streaming || !opts.models.textGeneration)(
      "declares streaming=false → registry has no stream function",
      async () => {
        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        const fn = registry.getStreamFn(model!.provider, "TextGenerationTask");
        expect(fn).toBeUndefined();
      },
      opts.timeout
    );

    it.skipIf(opts.capabilities.tools || !opts.models.textGeneration)(
      "declares tools=false → registry rejects ToolCallingTask lookup",
      async () => {
        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        expect(() =>
          registry.getDirectRunFn(model!.provider, "ToolCallingTask")
        ).toThrow();
      },
      opts.timeout
    );

    it.skipIf(opts.capabilities.embeddings || !opts.models.textGeneration)(
      "declares embeddings=false → registry rejects TextEmbeddingTask lookup",
      async () => {
        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        expect(() =>
          registry.getDirectRunFn(model!.provider, "TextEmbeddingTask")
        ).toThrow();
      },
      opts.timeout
    );

    it.skipIf(opts.capabilities.structured || !opts.models.textGeneration)(
      "declares structured=false → registry rejects StructuredGenerationTask lookup",
      async () => {
        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        expect(() =>
          registry.getDirectRunFn(model!.provider, "StructuredGenerationTask")
        ).toThrow();
      },
      opts.timeout
    );
  });
}
