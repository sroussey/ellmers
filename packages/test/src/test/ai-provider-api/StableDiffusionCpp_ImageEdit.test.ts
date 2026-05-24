/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStableDiffusionCppImageEditRunFn } from "@workglow/stable-diffusion-server/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workglow/ai/provider-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workglow/ai/provider-utils")>();
  return {
    ...actual,
    imageValueToPngBytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    pngBytesToImageValue: vi.fn(async () => ({ kind: "mock-image" })),
  };
});

afterEach(() => vi.restoreAllMocks());

const model = {
  provider_config: { base_url: "http://localhost:8080", model_name: "sd1.5" },
} as any;

describe("createStableDiffusionCppImageEditRunFn", () => {
  it("encodes input image as base64 PNG and POSTs to /img2img", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ images: ["aGVsbG8="] }), { status: 200 }));
    const fn = createStableDiffusionCppImageEditRunFn({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn(
      { prompt: "make it blue", image: { kind: "input-image" } } as any,
      model,
      undefined as any,
      emit
    );
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:8080/img2img");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.prompt).toBe("make it blue");
    expect(typeof body.init_image).toBe("string");
    expect(body.init_image.length).toBeGreaterThan(0); // base64 of [1,2,3,4]
    expect(body.model).toBe("sd1.5");
    expect(events.some((e) => e.type === "snapshot")).toBe(true);
    expect(events.at(-1)!.type).toBe("finish");
  });

  it("throws on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 400 }));
    const fn = createStableDiffusionCppImageEditRunFn({});
    await expect(
      fn(
        { prompt: "x", image: { kind: "input-image" } } as any,
        model,
        undefined as any,
        () => undefined
      )
    ).rejects.toThrow(/HTTP 400/);
  });

  it("throws when response contains no images", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    const fn = createStableDiffusionCppImageEditRunFn({});
    await expect(
      fn(
        { prompt: "x", image: { kind: "input-image" } } as any,
        model,
        undefined as any,
        () => undefined
      )
    ).rejects.toThrow(/no images/);
  });
});
