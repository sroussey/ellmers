/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createStableDiffusionCppImageGenerateRunFn,
  createStableDiffusionCppModelSearchRunFn,
} from "@workglow/stable-diffusion-server/ai-runtime";
import { describe, expect, it } from "vitest";

const RUN = process.env.RUN_SD_SERVER_TESTS === "1";
const BASE_URL = process.env.SD_SERVER_URL ?? "http://localhost:7860";

describe.skipIf(!RUN)("StableDiffusionCpp integration (real server)", () => {
  const model = {
    provider_config: { base_url: BASE_URL, model_name: "model" },
  } as any;

  it("image.generation produces a snapshot with an image", async () => {
    const fn = createStableDiffusionCppImageGenerateRunFn({ externalUrl: BASE_URL });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ prompt: "a small red square" } as any, model, undefined as any, emit);
    expect(events.some((e) => e.type === "snapshot")).toBe(true);
    expect(events.at(-1)!.type).toBe("finish");
  });

  it("model.search returns at least one entry via /v1/models", async () => {
    const fn = createStableDiffusionCppModelSearchRunFn({ externalUrl: BASE_URL });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "" } as any, undefined as any, undefined as any, emit);
    expect(events.at(-1)!.data.results.length).toBeGreaterThanOrEqual(1);
  });
});
