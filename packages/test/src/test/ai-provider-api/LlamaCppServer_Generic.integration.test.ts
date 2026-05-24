/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createLlamaCppServerModelInfoStream,
  createLlamaCppServerModelSearchStream,
  createLlamaCppServerTextEmbeddingStream,
  createLlamaCppServerTextGenerationStream,
} from "@workglow/llamacpp-server/ai-runtime";
import { describe, expect, it } from "vitest";

const RUN = process.env.RUN_LLAMACPP_SERVER_TESTS === "1";
const BASE_URL = process.env.LLAMACPP_SERVER_URL ?? "http://localhost:8080";

describe.skipIf(!RUN)("LlamaCppServer integration (real server)", () => {
  const model = {
    provider_config: { base_url: BASE_URL, model_name: "model" },
  } as any;

  it("text.generation streams non-empty content", async () => {
    const fn = createLlamaCppServerTextGenerationStream({ externalUrl: BASE_URL });
    let text = "";
    const emit = (e: any) => {
      if (e.type === "text-delta") text += e.textDelta;
    };
    await fn({ prompt: "Say hi.", maxTokens: 16 } as any, model, undefined as any, emit);
    expect(text.length).toBeGreaterThan(0);
  });

  it("model.search returns at least one entry via /v1/models", async () => {
    const fn = createLlamaCppServerModelSearchStream({ externalUrl: BASE_URL });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ query: "" } as any, undefined as any, undefined as any, emit);
    expect(events.at(-1)!.data.results.length).toBeGreaterThanOrEqual(1);
  });

  it("model.info reports is_loaded=true for the running model", async () => {
    const search = createLlamaCppServerModelSearchStream({ externalUrl: BASE_URL });
    const searchEvents: any[] = [];
    const searchEmit = (e: any) => searchEvents.push(e);
    await search({ query: "" } as any, undefined as any, undefined as any, searchEmit);
    const loaded = searchEvents.at(-1)!.data.results[0]!;
    const fn = createLlamaCppServerModelInfoStream({ externalUrl: BASE_URL });
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn(
      { model: loaded.id } as any,
      { provider_config: { base_url: BASE_URL, model_name: loaded.id } } as any,
      undefined as any,
      emit
    );
    expect(events.at(-1)!.data.is_loaded).toBe(true);
  });

  it("text.embedding returns a Float32Array (skipped if /v1/embeddings 404s)", async () => {
    const fn = createLlamaCppServerTextEmbeddingStream({ externalUrl: BASE_URL });
    try {
      const events: any[] = [];
      const emit = (e: any) => events.push(e);
      await fn({ text: "hello" } as any, model, undefined as any, emit);
      expect(events.at(-1)!.data.vector).toBeInstanceOf(Float32Array);
    } catch (err) {
      if (/HTTP 404/.test(String(err))) return; // server not started with --embedding
      throw err;
    }
  });
});
