/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStableDiffusionCppModelInfoRunFn } from "@workglow/stable-diffusion-server/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("createStableDiffusionCppModelInfoRunFn", () => {
  it("reports is_loaded=true when /v1/models includes the model name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "m" }, { id: "other" }] }), { status: 200 })
    );
    const fn = createStableDiffusionCppModelInfoRunFn({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn(
      { model: "m" } as any,
      { provider_config: { base_url: "http://localhost:8080", model_name: "m" } } as any,
      undefined as any,
      emit
    );
    expect(events.at(-1)!.data.is_loaded).toBe(true);
  });

  it("reports is_loaded=false when server unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const fn = createStableDiffusionCppModelInfoRunFn({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn(
      { model: "m" } as any,
      { provider_config: { base_url: "http://localhost:8080", model_name: "m" } } as any,
      undefined as any,
      emit
    );
    expect(events.at(-1)!.data.is_loaded).toBe(false);
  });

  it("reports is_loaded=false when /v1/models 404s", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    const fn = createStableDiffusionCppModelInfoRunFn({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn(
      { model: "m" } as any,
      { provider_config: { base_url: "http://localhost:8080", model_name: "m" } } as any,
      undefined as any,
      emit
    );
    expect(events.at(-1)!.data.is_loaded).toBe(false);
  });
});
