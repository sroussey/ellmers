/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createLlamaCppServerModelInfoStream } from "@workglow/llamacpp-server/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("createLlamaCppServerModelInfoStream", () => {
  it("trusts native_dimensions when set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fn = createLlamaCppServerModelInfoStream({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn(
      { detail: "dimensions", model: "m" } as any,
      { provider_config: { base_url: "http://localhost:8080", native_dimensions: 768 } } as any,
      undefined as any,
      emit
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.at(-1)!.data.native_dimensions).toBe(768);
  });

  it("falls back to /props for embedding dimensions", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/props")) {
        return new Response(JSON.stringify({ default_generation_settings: { n_embd: 1024 } }), {
          status: 200,
        });
      }
      return new Response("", { status: 404 });
    });
    const fn = createLlamaCppServerModelInfoStream({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn(
      { detail: "dimensions", model: "m" } as any,
      { provider_config: { base_url: "http://localhost:8080" } } as any,
      undefined as any,
      emit
    );
    expect(events.at(-1)!.data.native_dimensions).toBe(1024);
  });

  it("reports is_loaded=true when /v1/models includes the model name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "m" }, { id: "other" }] }), { status: 200 })
    );
    const fn = createLlamaCppServerModelInfoStream({});
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
    const fn = createLlamaCppServerModelInfoStream({});
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
