/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import type { IBackendsTransport, IRunningHandle } from "@workglow/ai/provider-utils";
import { _testOnly } from "@workglow/stable-diffusion-server/ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workglow/ai/provider-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workglow/ai/provider-utils")>();
  return {
    ...actual,
    pngBytesToImageValue: vi.fn(async () => ({ kind: "mock-image" })),
  };
});

const {
  StableDiffusionCppQueuedProvider,
  STABLE_DIFFUSION_CPP_RUN_FN_SPECS,
  buildStableDiffusionCppRunFns,
} = _testOnly;

function model(
  model_id: string,
  provider_config: Record<string, unknown> = { model_path: `/models/${model_id}` },
  capabilities: readonly string[] = []
): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "LOCAL_STABLE_DIFFUSION_CPP",
    provider_config,
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("StableDiffusionCppQueuedProvider.inferCapabilities", () => {
  const provider = new StableDiffusionCppQueuedProvider(buildStableDiffusionCppRunFns({}));

  it("infers full generative set for any non-empty model id", () => {
    const caps = provider.inferCapabilities(model("sd-1.5.gguf"));
    expect([...caps].sort()).toEqual([
      "image.editing",
      "image.generation",
      "model.info",
      "model.search",
    ]);
  });

  it("falls back to declared caps when id is empty", () => {
    const caps = provider.inferCapabilities(model("", {}, ["image.generation"]));
    expect(caps).toEqual(["image.generation"]);
  });

  it("falls back to baseline meta-ops when nothing declared and nothing matches", () => {
    const caps = provider.inferCapabilities(model("", {}));
    expect(caps).toEqual(["model.info", "model.search"]);
  });
});

describe("StableDiffusionCpp capability-set parity", () => {
  it("STABLE_DIFFUSION_CPP_RUN_FN_SPECS matches buildStableDiffusionCppRunFns({}) serves shapes", () => {
    const fns = buildStableDiffusionCppRunFns({});
    const fnsServes = fns.map((r) => [...r.serves].sort().join(","));
    const specsServes = STABLE_DIFFUSION_CPP_RUN_FN_SPECS.map((s) =>
      [...s.serves].sort().join(",")
    );
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("StableDiffusionCpp run-fn shape", () => {
  it("registers a runFn for every canonical capability set", () => {
    const sets = buildStableDiffusionCppRunFns({}).map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("image.generation");
    expect(sets).toContain("image.editing");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
  });
});

function fakeTransport(): IBackendsTransport & {
  ensureRunning: ReturnType<typeof vi.fn>;
} {
  return {
    ensureRunning: vi.fn(),
    subscribeStatus: vi.fn(() => () => undefined),
    install: vi.fn(),
    list: vi.fn(),
    uninstall: vi.fn(),
  } as unknown as IBackendsTransport & { ensureRunning: ReturnType<typeof vi.fn> };
}

describe("StableDiffusionCpp transport-mode run-fn (parity across inline + worker)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("acquires URL via transport and releases the handle (image.generation)", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const transport = fakeTransport();
    transport.ensureRunning.mockResolvedValue({
      url: "http://127.0.0.1:9999",
      release,
    } as IRunningHandle);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ images: ["aGk="] }), { status: 200 }));

    const fns = buildStableDiffusionCppRunFns({ transport });
    const imageGen = fns.find((r) => r.serves.join(",") === "image.generation")!;
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await imageGen.runFn(
      { prompt: "hi" } as any,
      { provider_config: { model_path: "/abs/m.gguf" } } as any,
      undefined as any,
      emit
    );

    expect(transport.ensureRunning).toHaveBeenCalledWith({
      backend: "stable-diffusion-server",
      modelPath: "/abs/m.gguf",
      opts: {},
    });
    const fetchedUrl = String(fetchSpy.mock.calls[0]![0]);
    expect(fetchedUrl).toBe("http://127.0.0.1:9999/txt2img");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
