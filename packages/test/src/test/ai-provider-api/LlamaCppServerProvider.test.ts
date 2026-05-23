/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import type { IBackendsTransport, IRunningHandle } from "@workglow/ai/provider-utils";
import { _testOnly } from "@workglow/llamacpp-server/ai";
import { describe, expect, it, vi } from "vitest";

const { LlamaCppServerQueuedProvider, LLAMACPP_SERVER_RUN_FN_SPECS, buildLlamaCppServerRunFns } =
  _testOnly;

function model(
  model_id: string,
  provider_config: Record<string, unknown> = { model_path: `/models/${model_id}` },
  capabilities: readonly string[] = []
): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "LOCAL_LLAMACPP_SERVER",
    provider_config,
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("LlamaCppServerQueuedProvider.inferCapabilities", () => {
  const provider = new LlamaCppServerQueuedProvider(buildLlamaCppServerRunFns({}));

  it("infers full text-gen set for a generic .gguf", () => {
    const caps = provider.inferCapabilities(model("llama-3-8b-q4_k_m.gguf"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("text.rewriter");
    expect(caps).toContain("text.summary");
    expect(caps).toContain("model.info");
    expect(caps).toContain("model.search");
    expect(caps).not.toContain("vision-input");
  });

  it("infers vision-input for llava-family", () => {
    const caps = provider.inferCapabilities(
      model("llava-7b-v1.6-q4_k_m.gguf", { model_path: "/models/llava-7b-v1.6-q4_k_m.gguf" })
    );
    expect(caps).toContain("vision-input");
    expect(caps).toContain("text.generation");
  });

  it("infers vision-input for bakllava", () => {
    const caps = provider.inferCapabilities(
      model("bakllava-q5.gguf", { model_path: "/models/bakllava-q5.gguf" })
    );
    expect(caps).toContain("vision-input");
  });

  it("infers text.embedding for nomic-embed gguf", () => {
    const caps = provider.inferCapabilities(
      model("nomic-embed-text.gguf", { model_path: "/models/nomic-embed-text.gguf" })
    );
    expect(caps).toContain("text.embedding");
    expect(caps).not.toContain("text.generation");
  });

  it("infers text.embedding when native_dimensions is set explicitly", () => {
    const caps = provider.inferCapabilities(
      model("custom.gguf", { model_path: "/models/custom.gguf", native_dimensions: 768 })
    );
    expect(caps).toEqual(["text.embedding", "model.info", "model.search"]);
  });

  it("falls back to declared caps when id is empty", () => {
    const caps = provider.inferCapabilities(model("", {}, ["text.classification"]));
    expect(caps).toEqual(["text.classification"]);
  });

  it("falls back to baseline meta-ops when nothing matches and nothing is declared", () => {
    const caps = provider.inferCapabilities(model("", {}));
    expect(caps).toEqual(["model.info", "model.search"]);
  });
});

describe("LlamaCppServer capability-set parity", () => {
  it("LLAMACPP_SERVER_RUN_FN_SPECS matches buildLlamaCppServerRunFns({}) serves shapes", () => {
    const fns = buildLlamaCppServerRunFns({});
    const fnsServes = fns.map((r) => [...r.serves].sort().join(","));
    const specsServes = LLAMACPP_SERVER_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("LlamaCppServer run-fn shape", () => {
  it("registers a runFn for every canonical capability set", () => {
    const sets = buildLlamaCppServerRunFns({}).map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.generation");
    expect(sets).toContain("text.generation,tool-use");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("text.embedding");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
  });

  it("tiebreaks text.generation to the smallest serves entry", () => {
    const candidates = buildLlamaCppServerRunFns({}).filter((r) =>
      r.serves.includes("text.generation")
    );
    expect(candidates.some((r) => r.serves.length === 1)).toBe(true);
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

describe("LlamaCppServer transport-mode run-fn (parity across inline + worker)", () => {
  it("acquires URL via transport and releases the handle (text.generation)", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const transport = fakeTransport();
    transport.ensureRunning.mockResolvedValue({
      url: "http://broker:9999",
      release,
    } as IRunningHandle);

    const enc = new TextEncoder();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n`)
            );
            controller.enqueue(enc.encode("data: [DONE]\n"));
            controller.close();
          },
        }),
        { status: 200 }
      )
    );

    const fns = buildLlamaCppServerRunFns({ transport });
    const textGen = fns.find((r) => r.serves.join(",") === "text.generation")!;
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await textGen.runFn(
      { prompt: "hi" } as any,
      { provider_config: { model_path: "/abs/m.gguf", ctx: 4096 } } as any,
      undefined as any,
      emit
    );

    expect(transport.ensureRunning).toHaveBeenCalledWith({
      backend: "llamacpp-server",
      modelPath: "/abs/m.gguf",
      opts: { ctx: 4096 },
    });
    const fetchedUrl = String(fetchSpy.mock.calls[0]![0]);
    expect(fetchedUrl).toBe("http://broker:9999/v1/chat/completions");
    expect(release).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
