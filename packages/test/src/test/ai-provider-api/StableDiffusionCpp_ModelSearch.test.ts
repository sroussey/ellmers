/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStableDiffusionCppModelSearchRunFn } from "@workglow/stable-diffusion-server/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("createStableDiffusionCppModelSearchRunFn", () => {
  it("returns [] when no externalUrl set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fn = createStableDiffusionCppModelSearchRunFn({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "" } as any, undefined as any, undefined as any, emit);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.at(-1)!.data.results).toEqual([]);
  });

  it("returns mapped results from /v1/models when externalUrl set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "loaded-model" }] }), { status: 200 })
    );
    const fn = createStableDiffusionCppModelSearchRunFn({ externalUrl: "http://localhost:8080" });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "" } as any, undefined as any, undefined as any, emit);
    const results = events.at(-1)!.data.results;
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("loaded-model");
    expect(results[0].record.provider).toBe("LOCAL_STABLE_DIFFUSION_CPP");
    expect(results[0].record.provider_config.base_url).toBe("http://localhost:8080");
  });

  it("returns [] when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const fn = createStableDiffusionCppModelSearchRunFn({ externalUrl: "http://localhost:8080" });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "" } as any, undefined as any, undefined as any, emit);
    expect(events.at(-1)!.data.results).toEqual([]);
  });

  it("does not fetch public externalUrl values", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fn = createStableDiffusionCppModelSearchRunFn({
      externalUrl: "https://example.com:8080",
    });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "" } as any, undefined as any, undefined as any, emit);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.at(-1)!.data.results).toEqual([]);
  });

  it("filters by query case-insensitively", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "sd-1.5" }, { id: "Flux-1" }] }), {
        status: 200,
      })
    );
    const fn = createStableDiffusionCppModelSearchRunFn({ externalUrl: "http://localhost:8080" });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "flux" } as any, undefined as any, undefined as any, emit);
    const results = events.at(-1)!.data.results;
    expect(results.map((r: any) => r.id)).toEqual(["Flux-1"]);
  });
});
