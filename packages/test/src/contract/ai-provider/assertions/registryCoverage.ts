/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts } from "../types";

export function registryCoverageBlock(opts: AiProviderConformanceOpts, providerName: string): void {
  describe("Registry coverage", () => {
    it("has a direct run function for every advertised task type", () => {
      const registry = getAiProviderRegistry();
      const provider = registry.getProvider(providerName);
      expect(provider).toBeDefined();
      const taskTypes = provider!.taskTypes;
      expect(taskTypes.length).toBeGreaterThan(0);
      for (const taskType of taskTypes) {
        expect(
          () => registry.getDirectRunFn(providerName, taskType),
          `provider "${providerName}" advertises taskType "${taskType}" but has no run function registered`
        ).not.toThrow();
      }
    }, opts.timeout);
  });
}
