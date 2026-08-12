/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/openai/ai";
import { describe, expect, it } from "vitest";
const { finalizeResponsesRequest } = _testOnly;

/**
 * `temperature` and `reasoning` are not independently selectable on the OpenAI
 * reasoning families. Verified live against `gpt-5.6-luna`:
 *   temperature: 0                              -> 400 Unsupported parameter
 *   reasoning: {effort:"none"}                  -> 200
 *   reasoning: {effort:"none"}, temperature: 0  -> 200
 * So a request that pins a temperature must turn reasoning off to be accepted.
 */
describe("finalizeResponsesRequest reasoning/temperature coupling", () => {
  const model = (reasoning?: unknown) =>
    ({
      provider_config: { model_name: "gpt-5.6-luna", ...(reasoning ? { reasoning } : {}) },
    }) as never;

  it("forces reasoning off when a temperature is pinned and none is configured", () => {
    const params = finalizeResponsesRequest(model(), { model: "gpt-5.6-luna", temperature: 0 });
    expect(params.reasoning).toEqual({ effort: "none" });
  });

  it("does so for any pinned temperature, not just zero", () => {
    const params = finalizeResponsesRequest(model(), { model: "gpt-5.6-luna", temperature: 0.7 });
    expect(params.reasoning).toEqual({ effort: "none" });
  });

  it("sends no reasoning field when no temperature is pinned", () => {
    const params = finalizeResponsesRequest(model(), { model: "gpt-5.6-luna" });
    expect(params.reasoning).toBeUndefined();
  });

  it("never overrides an explicitly configured reasoning effort", () => {
    const params = finalizeResponsesRequest(model({ effort: "high" }), {
      model: "gpt-5.6-luna",
      temperature: 0,
    });
    expect(params.reasoning).toEqual({ effort: "high" });
  });

  it("honours model.effort over the temperature auto-none default", () => {
    const params = finalizeResponsesRequest(
      { provider_config: { model_name: "gpt-5.6-luna" }, effort: "medium" } as never,
      { model: "gpt-5.6-luna", temperature: 0 }
    );
    expect(params.reasoning).toEqual({ effort: "medium" });
  });
});
