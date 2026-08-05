/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai";
import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { LOCAL_MLX, MlxProvider, registerMlx } from "@workglow/mlx/ai";
import { beforeEach, describe, expect, it } from "vitest";

const TEXT_GENERATION: readonly Capability[] = ["text.generation"];

describe("MlxProvider", () => {
  let registry: AiProviderRegistry;

  beforeEach(() => {
    setAiProviderRegistry(new AiProviderRegistry());
    registry = getAiProviderRegistry();
  });

  it("reports itself unavailable (no bundled mlx-lm Python runtime)", async () => {
    expect(await new MlxProvider().isAvailable()).toBe(false);
  });

  it("declares its runtime placement metadata", () => {
    const provider = new MlxProvider();
    expect(provider.name).toBe(LOCAL_MLX);
    expect(provider.displayName).toBe("Local MLX (Apple Silicon)");
    expect(provider.isLocal).toBe(true);
    expect(provider.supportsBrowser).toBe(false);
    expect(provider.supportsServer).toBe(true);
  });

  describe("registerMlx", () => {
    it("resolves without throwing", async () => {
      await expect(registerMlx()).resolves.toBeUndefined();
    });

    it("registers no provider while unavailable", async () => {
      await registerMlx();

      expect(registry.getProvider(LOCAL_MLX)).toBeUndefined();
      expect(registry.getInstalledProviderIds()).not.toContain(LOCAL_MLX);
      expect(registry.getProviders().has(LOCAL_MLX)).toBe(false);
    });

    it("does not offer the provider for text.generation", async () => {
      await registerMlx();

      expect(registry.getProviderIdsForCapabilities(TEXT_GENERATION)).not.toContain(LOCAL_MLX);
    });
  });

  describe("direct registration backstop", () => {
    it("still throws on inference for anyone registering the provider directly", async () => {
      await new MlxProvider().register({});

      const runFn = registry.getRunFnFor(LOCAL_MLX, TEXT_GENERATION);
      expect(runFn).toBeDefined();

      await expect(
        runFn!({ prompt: "hello" }, undefined, new AbortController().signal, () => {})
      ).rejects.toThrow(/Python runtime not bundled/);
    });
  });
});
