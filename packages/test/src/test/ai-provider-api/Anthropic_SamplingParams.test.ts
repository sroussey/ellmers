/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/anthropic/ai";
import { getLogger } from "@workglow/util";
import { afterEach, describe, expect, it, vi } from "vitest";

const { anthropicAcceptsSamplingParams, applyAnthropicSamplingParams } = _testOnly;

function cfg(provider_config: Record<string, unknown>) {
  return { provider: "ANTHROPIC", provider_config } as never;
}

function model(modelName: string) {
  return cfg({ model_name: modelName });
}

describe("anthropicAcceptsSamplingParams — rejecting models", () => {
  // Every id here returns HTTP 400 when temperature/top_p is sent.
  const rejects = [
    "claude-opus-5",
    "claude-fable-5",
    "claude-mythos-5",
    "claude-mythos-preview",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
  ];

  it.each(rejects)("omits sampling params for %s", (id) => {
    expect(anthropicAcceptsSamplingParams(model(id))).toBe(false);
  });
});

describe("anthropicAcceptsSamplingParams — accepting models", () => {
  const accepts = [
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-opus-4-5",
    "claude-opus-4-1",
    // Regression: the trailing 8-digit segment is a release date, not minor 20250514.
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    // Regression: legacy `claude-<major>-<minor>-<family>` id shape.
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-7-sonnet-20250219",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
    "claude-2.1",
  ];

  it.each(accepts)("sends sampling params for %s", (id) => {
    expect(anthropicAcceptsSamplingParams(model(id))).toBe(true);
  });
});

describe("anthropicAcceptsSamplingParams — safe default and override", () => {
  it("defaults to omitting for an unrecognized or future model id", () => {
    // A brand-new id matches no known-accepting shape, so params are omitted
    // and the request succeeds rather than failing with a 400.
    expect(anthropicAcceptsSamplingParams(model("claude-opus-6"))).toBe(false);
    expect(anthropicAcceptsSamplingParams(model("claude-quasar-9"))).toBe(false);
    expect(anthropicAcceptsSamplingParams(model("gpt-4o"))).toBe(false);
    expect(anthropicAcceptsSamplingParams(model(""))).toBe(false);
    expect(anthropicAcceptsSamplingParams(cfg({}))).toBe(false);
  });

  it("honors an explicit sampling_params override in both directions", () => {
    expect(
      anthropicAcceptsSamplingParams(cfg({ model_name: "claude-opus-5", sampling_params: "send" }))
    ).toBe(true);
    expect(
      anthropicAcceptsSamplingParams(
        cfg({ model_name: "claude-haiku-4-5", sampling_params: "omit" })
      )
    ).toBe(false);
  });
});

describe("applyAnthropicSamplingParams", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("assigns both wire names on an accepting model", () => {
    const params: Record<string, unknown> = {};
    applyAnthropicSamplingParams(
      params,
      { temperature: 0.4, topP: 0.9 },
      model("claude-haiku-4-5")
    );
    expect(params.temperature).toBe(0.4);
    expect(params.top_p).toBe(0.9);
  });

  it("leaves the keys absent on a rejecting model", () => {
    const params: Record<string, unknown> = {};
    applyAnthropicSamplingParams(params, { temperature: 0.4, topP: 0.9 }, model("claude-opus-5"));
    // Absent, not present-and-undefined — the SDK would serialize a null field.
    expect("temperature" in params).toBe(false);
    expect("top_p" in params).toBe(false);
  });

  it("does not warn when nothing was supplied", () => {
    const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
    const params: Record<string, unknown> = {};
    applyAnthropicSamplingParams(params, {}, model("claude-opus-5"));
    expect(warn).not.toHaveBeenCalled();
    expect(params).toEqual({});
  });

  it("warns exactly once naming every dropped parameter", () => {
    const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
    applyAnthropicSamplingParams({}, { temperature: 0.4, topP: 0.9 }, model("claude-opus-5"));
    expect(warn).toHaveBeenCalledTimes(1);
    const meta = warn.mock.calls[0]?.[1] as { model: string; dropped: string[] };
    expect(meta.model).toBe("claude-opus-5");
    expect(meta.dropped).toEqual(["temperature", "top_p"]);
  });
});
