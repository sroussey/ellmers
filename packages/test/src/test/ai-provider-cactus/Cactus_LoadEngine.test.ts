/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import {
  loadCactusEngine,
  type NeedleSdkModule,
} from "../../../../../providers/cactus/src/ai/common/Cactus_LoadEngine";
import type { CactusCatalogEntry } from "../../../../../providers/cactus/src/ai/common/Cactus_ModelCatalog";

describe("loadCactusEngine", () => {
  it("loads v2 engines from the .cact bytes via NeedleV2Wasm.load", () => {
    const cactBytes = new Uint8Array([7, 8, 9]);
    const expectedEngine = { run: vi.fn() };
    const loadV2 = vi.fn(() => expectedEngine);
    const loadV1 = vi.fn();
    const sdk = {
      NeedleV2Wasm: { load: loadV2 },
      NeedleWasm: { load: loadV1 },
    } as unknown as NeedleSdkModule;
    const entry = {
      model_id: "needle-v2",
      title: "Needle 2",
      description: "",
      hf_repo: "repo",
      revision: "rev",
      generation: 2,
      assets: {
        cact: { filename: "needle2.cact", sha256: "x", size: cactBytes.byteLength },
      },
      capabilities: ["tool-use"],
    } as unknown as CactusCatalogEntry;

    const engine = loadCactusEngine(sdk, entry, { "needle2.cact": cactBytes });
    expect(engine).toBe(expectedEngine);
    expect(loadV2).toHaveBeenCalledOnce();
    expect(loadV2).toHaveBeenCalledWith(cactBytes);
    expect(loadV1).not.toHaveBeenCalled();
  });

  it("keeps compatibility with v1 entries that omit generation", () => {
    const weights = new Uint8Array([1, 2, 3]);
    const vocabBytes = new TextEncoder().encode("token");
    const expectedEngine = { run: vi.fn() };
    const loadV1 = vi.fn(() => expectedEngine);
    const loadV2 = vi.fn();
    const sdk = {
      NeedleV2Wasm: { load: loadV2 },
      NeedleWasm: { load: loadV1 },
    } as unknown as NeedleSdkModule;
    const entry = {
      model_id: "needle-26m",
      title: "Needle 26M",
      description: "",
      hf_repo: "repo",
      revision: "rev",
      assets: {
        weights: { filename: "needle.safetensors", sha256: "x", size: weights.byteLength },
        vocab: { filename: "vocab.txt", sha256: "x", size: vocabBytes.byteLength },
        config: { filename: "config.json", sha256: "x", size: 2 },
      },
      capabilities: ["tool-use"],
    } as unknown as CactusCatalogEntry;

    const engine = loadCactusEngine(sdk, entry, {
      "needle.safetensors": weights,
      "vocab.txt": vocabBytes,
    });
    expect(engine).toBe(expectedEngine);
    expect(loadV1).toHaveBeenCalledOnce();
    expect(loadV1).toHaveBeenCalledWith(weights, "token");
    expect(loadV2).not.toHaveBeenCalled();
  });
});
