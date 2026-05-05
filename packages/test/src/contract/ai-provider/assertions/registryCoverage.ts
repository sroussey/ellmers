/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts } from "../types";

export function registryCoverageBlock(opts: AiProviderConformanceOpts): void {
  describe("Registry coverage", () => {
    it(
      "has a direct run function for every advertised task type",
      async () => {
        const anyModelId =
          opts.models.textGeneration ??
          opts.models.toolCalling ??
          opts.models.structured ??
          opts.models.embeddings;
        expect(
          anyModelId,
          "registryCoverageBlock requires at least one model id in opts.models"
        ).toBeDefined();

        const model = await getGlobalModelRepository().findByName(anyModelId!);
        expect(model, `model "${anyModelId}" not found in repository`).toBeDefined();
        const providerKey = model!.provider;

        const registry = getAiProviderRegistry();
        const provider = registry.getProvider(providerKey);
        expect(provider, `provider "${providerKey}" not registered`).toBeDefined();
        const taskTypes = provider!.taskTypes;
        expect(taskTypes.length).toBeGreaterThan(0);
        for (const taskType of taskTypes) {
          expect(
            () => registry.getDirectRunFn(providerKey, taskType),
            `provider "${providerKey}" advertises taskType "${taskType}" but has no run function registered`
          ).not.toThrow();
        }
      },
      opts.timeout
    );
  });
}
