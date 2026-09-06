/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Anthropic_ModelSearch_Stream, getAnthropicModelPricing } from "@workglow/anthropic/ai";
import { DeepSeek_ModelSearch_Stream, getDeepSeekModelPricing } from "@workglow/deepseek/ai";
import { Gemini_ModelSearch_Stream, getGeminiModelPricing } from "@workglow/google-gemini/ai";
import { OpenAI_ModelSearch_Stream, getOpenAiModelPricing } from "@workglow/openai/ai";
import { Xai_ModelSearch_Stream, getXaiModelPricing } from "@workglow/xai/ai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

/**
 * `model add` / `model find` persist the record a search result carries, and a
 * persisted rate card is never revisited. A card copied out of the provider's
 * table at search time therefore freezes those rates into the repository: the
 * table is the maintained source and correcting a rate there would no longer
 * reach the model, with nothing on screen to say the figure is old.
 *
 * So a search result describes the model and leaves `pricing` unset. The rate
 * is resolved from the provider's table when a cost is estimated, and a card
 * that IS on a record means someone declared it deliberately.
 */
async function searchRecords(
  fn: (input: any, model: any, signal: any, emit: any) => Promise<void>
): Promise<any[]> {
  const events: any[] = [];
  await fn({ query: "" } as any, undefined as any, undefined as any, (e: any) => events.push(e));
  const results = events.at(-1)!.data.results as any[];
  expect(results.length).toBeGreaterThan(0);
  return results;
}

describe("cloud model search results", () => {
  it("leaves pricing unset on Anthropic records while the table still prices them", async () => {
    const results = await searchRecords(Anthropic_ModelSearch_Stream);
    for (const result of results) {
      expect(result.record.pricing).toBeUndefined();
      expect(getAnthropicModelPricing(result.id)).toBeDefined();
    }
  });

  it("leaves pricing unset on OpenAI records while the table still prices them", async () => {
    const results = await searchRecords(OpenAI_ModelSearch_Stream);
    for (const result of results) {
      expect(result.record.pricing).toBeUndefined();
    }
    expect(results.some((result) => getOpenAiModelPricing(result.id) !== undefined)).toBe(true);
  });

  it("leaves pricing unset on DeepSeek records while the table still prices them", async () => {
    const results = await searchRecords(DeepSeek_ModelSearch_Stream);
    for (const result of results) {
      expect(result.record.pricing).toBeUndefined();
    }
    expect(results.some((result) => getDeepSeekModelPricing(result.id) !== undefined)).toBe(true);
  });

  it("leaves pricing unset on xAI records while the table still prices them", async () => {
    const results = await searchRecords(Xai_ModelSearch_Stream);
    for (const result of results) {
      expect(result.record.pricing).toBeUndefined();
    }
    expect(results.some((result) => getXaiModelPricing(result.id) !== undefined)).toBe(true);
  });

  // Gemini maps the live /models listing through a different function than its
  // credential-free fallback list, and only the live one ever carried a card —
  // so the listing is what this has to exercise.
  it("leaves pricing unset on Gemini records from the live listing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }],
        }),
        { status: 200 }
      )
    );
    const events: any[] = [];
    await Gemini_ModelSearch_Stream(
      { query: "", credential_key: "test-key" } as any,
      undefined as any,
      undefined as any,
      (e: any) => events.push(e)
    );
    const results = events.at(-1)!.data.results as any[];
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("gemini-2.5-pro");
    expect(results[0].record.pricing).toBeUndefined();
    expect(getGeminiModelPricing("gemini-2.5-pro")).toBeDefined();
  });
});
