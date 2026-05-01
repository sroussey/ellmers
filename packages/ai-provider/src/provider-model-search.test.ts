/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelSearchTask } from "@workglow/ai";
import { afterEach, describe, expect, test } from "bun:test";
import { Anthropic_ModelSearch } from "./provider-anthropic/common/Anthropic_ModelSearch";
import { Gemini_ModelSearch } from "./provider-gemini/common/Gemini_ModelSearch";
import { HFI_ModelSearch } from "./provider-hf-inference/common/HFI_ModelSearch";
import { OpenAI_ModelSearch } from "./provider-openai/common/OpenAI_ModelSearch";

const originalFetch = globalThis.fetch;

async function modelIdsForSearch(
  search: typeof OpenAI_ModelSearch,
  query: string
): Promise<string[]> {
  const { results } = await search(
    { query } as any,
    undefined as any,
    undefined as any,
    undefined as any
  );
  return results.map((model) => model.id);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("provider model search samples", () => {
  test("ModelSearchTask input schema marks credential_key as a credential", () => {
    const schema = ModelSearchTask.inputSchema();
    expect(schema).toMatchObject({
      properties: {
        credential_key: { type: "string", format: "credential" },
      },
    });
  });

  test("OpenAI fallback includes the latest flagship sample", async () => {
    await expect(modelIdsForSearch(OpenAI_ModelSearch, "gpt-5.5")).resolves.toContain("gpt-5.5");
  });

  test("Anthropic fallback includes the latest Claude samples", async () => {
    await expect(modelIdsForSearch(Anthropic_ModelSearch, "claude-opus-4-7")).resolves.toContain(
      "claude-opus-4-7"
    );
    await expect(modelIdsForSearch(Anthropic_ModelSearch, "claude-sonnet-4-6")).resolves.toContain(
      "claude-sonnet-4-6"
    );
  });

  test("Gemini static list includes current text, image, and embedding samples", async () => {
    await expect(
      modelIdsForSearch(Gemini_ModelSearch, "gemini-3.1-pro-preview")
    ).resolves.toContain("gemini-3.1-pro-preview");
    await expect(
      modelIdsForSearch(Gemini_ModelSearch, "gemini-3.1-flash-image-preview")
    ).resolves.toContain("gemini-3.1-flash-image-preview");
    await expect(modelIdsForSearch(Gemini_ModelSearch, "gemini-embedding-2")).resolves.toContain(
      "gemini-embedding-2"
    );
  });

  test("Gemini live search uses the supplied credential", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrl = input.toString();
      return Response.json({
        models: [
          {
            name: "models/gemini-live-test",
            displayName: "Gemini Live Test",
            description: "Live model",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      });
    }) as unknown as typeof fetch;

    const { results } = await Gemini_ModelSearch(
      { query: "live", credential_key: "test-gemini-key" } as any,
      undefined as any,
      undefined as any,
      undefined as any
    );

    expect(requestedUrl).toContain("key=test-gemini-key");
    expect(results.map((model) => model.id)).toContain("gemini-live-test");
  });

  test("Gemini live search rejects API failures when credentialed", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;

    await expect(
      Gemini_ModelSearch(
        { query: "live", credential_key: "bad-gemini-key" } as any,
        undefined as any,
        undefined as any,
        undefined as any
      )
    ).rejects.toThrow("Gemini API returned 401");
  });

  test("Hugging Face Inference live search uses the supplied credential", async () => {
    let authorization = "";
    globalThis.fetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      const headers = new Headers(init?.headers);
      authorization = headers.get("authorization") ?? "";
      return Response.json([
        {
          id: "org/live-hfi-model",
          modelId: "org/live-hfi-model",
          pipeline_tag: "text-generation",
          likes: 10,
          downloads: 100,
        },
      ]);
    }) as unknown as typeof fetch;

    const { results } = await HFI_ModelSearch(
      { query: "live", credential_key: "test-hf-key" } as any,
      undefined as any,
      undefined as any,
      undefined as any
    );

    expect(authorization).toBe("Bearer test-hf-key");
    expect(results.map((model) => model.id)).toContain("org/live-hfi-model");
  });

  test("Hugging Face Inference live search rejects API failures when credentialed", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;

    await expect(
      HFI_ModelSearch(
        { query: "live", credential_key: "bad-hf-key" } as any,
        undefined as any,
        undefined as any,
        undefined as any
      )
    ).rejects.toThrow("HuggingFace API returned 401");
  });
});
