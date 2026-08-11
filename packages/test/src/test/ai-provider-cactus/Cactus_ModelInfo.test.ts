/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelInfoTaskOutput } from "@workglow/ai";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFnFor } from "./test-utils";

const Cactus_ModelInfo = runFnFor(["model.info"]);

describe("Cactus_ModelInfo", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("emits a finish with local+browser+node, not-cached, not-loaded when fresh", async () => {
    let data: ModelInfoTaskOutput | undefined;
    const controller = new AbortController();
    await Cactus_ModelInfo(
      {
        model: {
          model_id: "x",
          title: "x",
          description: "",
          provider: "LOCAL_CACTUS",
          provider_config: { model_id: "needle-26m" },
          capabilities: ["tool-use"],
          metadata: {},
        },
        detail: "cached_status",
      },
      {
        model_id: "x",
        title: "x",
        description: "",
        provider: "LOCAL_CACTUS",
        provider_config: { model_id: "needle-26m" },
        capabilities: ["tool-use"],
        metadata: {},
      },
      controller.signal,
      (ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }
    );
    expect(data?.is_local).toBe(true);
    expect(data?.supports_browser).toBe(true);
    expect(data?.supports_node).toBe(true);
    expect(data?.is_cached).toBe(false);
    expect(data?.is_loaded).toBe(false);
  });

  it("reports persisted cache status and file sizes from the model directory", async () => {
    dir = mkdtempSync(join(tmpdir(), "cactus-model-info-"));
    const modelDir = join(dir, "needle-26m");
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, "needle.safetensors"), new Uint8Array([1, 2, 3, 4]));
    writeFileSync(join(modelDir, "vocab.txt"), new Uint8Array([1, 2]));
    writeFileSync(join(modelDir, "config.json"), new Uint8Array([1]));

    let data: ModelInfoTaskOutput | undefined;
    const controller = new AbortController();
    await Cactus_ModelInfo(
      {
        model: {
          model_id: "x",
          title: "x",
          description: "",
          provider: "LOCAL_CACTUS",
          provider_config: { model_id: "needle-26m", models_dir: dir },
          capabilities: ["tool-use"],
          metadata: {},
        },
        detail: "files_with_metadata",
      } as any,
      {
        model_id: "x",
        title: "x",
        description: "",
        provider: "LOCAL_CACTUS",
        provider_config: { model_id: "needle-26m", models_dir: dir },
        capabilities: ["tool-use"],
        metadata: {},
      } as any,
      controller.signal,
      (ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }
    );

    expect(data?.is_cached).toBe(true);
    expect(data?.file_sizes).toEqual({
      "needle.safetensors": 4,
      "vocab.txt": 2,
      "config.json": 1,
    });
  });
});
