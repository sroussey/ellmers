/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createLlamaCppServerModelSearchStream } from "@workglow/llamacpp-server/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("createLlamaCppServerModelSearchStream", () => {
  it("returns [] when no externalUrl set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fn = createLlamaCppServerModelSearchStream({});
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
    const fn = createLlamaCppServerModelSearchStream({ externalUrl: "http://x:8080" });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "" } as any, undefined as any, undefined as any, emit);
    const results = events.at(-1)!.data.results;
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("loaded-model");
    expect(results[0].record.provider).toBe("LOCAL_LLAMACPP_SERVER");
    expect(results[0].record.provider_config.base_url).toBe("http://x:8080");
  });

  it("returns [] when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const fn = createLlamaCppServerModelSearchStream({ externalUrl: "http://x:8080" });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "" } as any, undefined as any, undefined as any, emit);
    expect(events.at(-1)!.data.results).toEqual([]);
  });

  it("filters by query case-insensitively", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "Llama-3" }, { id: "Mistral" }] }), {
        status: 200,
      })
    );
    const fn = createLlamaCppServerModelSearchStream({ externalUrl: "http://x:8080" });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "llama" } as any, undefined as any, undefined as any, emit);
    const results = events.at(-1)!.data.results;
    expect(results.map((r: any) => r.id)).toEqual(["Llama-3"]);
  });
});
