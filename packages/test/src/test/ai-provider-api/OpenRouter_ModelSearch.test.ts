/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/openrouter/ai";
import { describe, expect, it } from "vitest";

const { mapOpenRouterModels } = _testOnly;

describe("mapOpenRouterModels", () => {
  it("maps /models entries to result items with data-driven capabilities", () => {
    const items = mapOpenRouterModels([
      {
        id: "anthropic/claude-sonnet-4",
        name: "Anthropic: Claude Sonnet 4",
        description: "desc",
        context_length: 200000,
        pricing: { prompt: "0.000003", completion: "0.000015" },
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: ["tools", "response_format"],
      },
    ]);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.id).toBe("anthropic/claude-sonnet-4");
    expect(item.record.provider).toBe("OPENROUTER");
    expect(item.record.provider_config).toEqual({ model_name: "anthropic/claude-sonnet-4" });
    expect(item.record.capabilities).toContain("tool-use");
    expect(item.record.capabilities).toContain("json-mode");
    expect(item.record.capabilities).toContain("vision-input");
    expect((item.record.metadata as Record<string, unknown>).context_length).toBe(200000);
  });
});
