/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/openrouter/ai";
import { describe, expect, it } from "vitest";

const { buildChatParams, buildOpenRouterExtras } = _testOnly;

function cfg(provider_config: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { provider: "OPENROUTER", provider_config, ...extra } as never;
}

describe("buildChatParams", () => {
  it("wraps a prompt as a single user message and maps sampling params", () => {
    const params = buildChatParams(
      { prompt: "hi", maxTokens: 100, temperature: 0.5 } as never,
      cfg({ model_name: "openai/gpt-5" })
    );
    expect(params.model).toBe("openai/gpt-5");
    expect(params.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(params.max_completion_tokens).toBe(100);
    expect(params.temperature).toBe(0.5);
  });
});

describe("buildOpenRouterExtras", () => {
  it("serializes routing, reasoning, and web search", () => {
    const extras = buildOpenRouterExtras(
      cfg({
        model_name: "openai/gpt-5",
        provider_routing: { sort: "price", allow_fallbacks: true },
        reasoning: { effort: "high" },
        web_search: true,
      })
    );
    expect(extras.provider).toEqual({ sort: "price", allow_fallbacks: true });
    expect(extras.reasoning).toEqual({ effort: "high" });
    expect(extras.plugins).toEqual([{ id: "web" }]);
  });

  it("passes web_search object options through", () => {
    const extras = buildOpenRouterExtras(
      cfg({ model_name: "openai/gpt-5", web_search: { max_results: 3 } })
    );
    expect(extras.plugins).toEqual([{ id: "web", max_results: 3 }]);
  });

  it("returns an empty object when no native controls are set", () => {
    const extras = buildOpenRouterExtras(cfg({ model_name: "openai/gpt-5" }));
    expect(extras).toEqual({});
  });

  it("maps model.effort when provider_config.reasoning is unset", () => {
    expect(buildOpenRouterExtras(cfg({ model_name: "openai/gpt-5" }, { effort: "high" }))).toEqual({
      reasoning: { effort: "high" },
    });
    expect(buildOpenRouterExtras(cfg({ model_name: "openai/gpt-5" }, { effort: "none" }))).toEqual({
      reasoning: { effort: "none", exclude: true },
    });
    expect(buildOpenRouterExtras(cfg({ model_name: "openai/gpt-5" }, { effort: "extra" }))).toEqual(
      { reasoning: { effort: "xhigh" } }
    );
    expect(buildOpenRouterExtras(cfg({ model_name: "openai/gpt-5" }, { effort: "ultra" }))).toEqual(
      { reasoning: { effort: "max" } }
    );
  });

  it("lets provider_config.reasoning win over model.effort", () => {
    expect(
      buildOpenRouterExtras(
        cfg({ model_name: "openai/gpt-5", reasoning: { effort: "low" } }, { effort: "ultra" })
      )
    ).toEqual({ reasoning: { effort: "low" } });
  });

  // The policy used to return every level for every id, which left this branch
  // unable to reject anything: an embedding model was handed a `reasoning`.
  it("does not map model.effort onto a non-text model", () => {
    expect(
      buildOpenRouterExtras(
        cfg({ model_name: "openai/text-embedding-3-small" }, { effort: "high" })
      )
    ).toEqual({});
    expect(
      buildOpenRouterExtras(
        cfg({ model_name: "black-forest-labs/flux-1.1-pro" }, { effort: "high" })
      )
    ).toEqual({});
  });

  it("does not map model.effort when effort_options is empty", () => {
    expect(
      buildOpenRouterExtras(
        cfg({ model_name: "openai/gpt-5" }, { effort: "high", effort_options: [] })
      )
    ).toEqual({});
  });
});
