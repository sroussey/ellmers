/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from "bun:test";
import { Anthropic_ModelSearch } from "./provider-anthropic/common/Anthropic_ModelSearch";
import { Gemini_ModelSearch } from "./provider-gemini/common/Gemini_ModelSearch";
import { OpenAI_ModelSearch } from "./provider-openai/common/OpenAI_ModelSearch";

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

describe("provider model search samples", () => {
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
});
