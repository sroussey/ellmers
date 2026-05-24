/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStableDiffusionCppImageGenerateRunFn } from "@workglow/stable-diffusion-server/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workglow/ai/provider-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workglow/ai/provider-utils")>();
  return {
    ...actual,
    pngBytesToImageValue: vi.fn(async () => ({ kind: "mock-image" })),
  };
});

afterEach(() => vi.restoreAllMocks());

const model = {
  provider_config: { base_url: "http://localhost:8080", model_name: "sd1.5" },
} as any;

describe("createStableDiffusionCppImageGenerateRunFn", () => {
  it("POSTs to /txt2img by default and emits snapshot + finish", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ images: ["aGVsbG8="] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const fn = createStableDiffusionCppImageGenerateRunFn({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ prompt: "draw a cat" } as any, model, undefined as any, emit);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:8080/txt2img");
    expect(events.some((e) => e.type === "snapshot")).toBe(true);
    expect(events.at(-1)!.type).toBe("finish");
  });

  it("uses the OpenAI-compat endpoint when configured at the model level", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ images: ["aGk="] }), { status: 200 }));
    const fn = createStableDiffusionCppImageGenerateRunFn({});
    await fn(
      { prompt: "x" } as any,
      {
        provider_config: {
          base_url: "http://localhost:8080",
          model_name: "sd1.5",
          endpoint: "/v1/images/generations",
        },
      } as any,
      undefined as any,
      () => undefined
    );
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("http://localhost:8080/v1/images/generations");
  });

  it("throws on non-2xx with informative message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const fn = createStableDiffusionCppImageGenerateRunFn({});
    await expect(
      fn({ prompt: "x" } as any, model, undefined as any, () => undefined)
    ).rejects.toThrow(/HTTP 500/);
  });

  it("throws when response contains no images", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ images: [] }), { status: 200 })
    );
    const fn = createStableDiffusionCppImageGenerateRunFn({});
    await expect(
      fn({ prompt: "x" } as any, model, undefined as any, () => undefined)
    ).rejects.toThrow(/no images/);
  });
});
