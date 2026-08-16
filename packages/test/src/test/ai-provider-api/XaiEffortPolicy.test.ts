/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { MODEL_EFFORTS } from "@workglow/ai";
import type { XaiModelConfig } from "@workglow/xai/ai";
import { getXaiReasoningEffort, XAI, xaiEffortPolicy } from "@workglow/xai/ai";
import { describe, expect, it } from "vitest";

function cfg(model_name: string, extra?: Partial<XaiModelConfig>): XaiModelConfig {
  return {
    provider: XAI,
    provider_config: { model_name },
    ...extra,
  } as XaiModelConfig;
}

describe("xaiEffortPolicy", () => {
  it("returns all levels with no default when the name is empty", () => {
    expect(xaiEffortPolicy(cfg(""))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: undefined,
    });
  });

  it("treats reasoning Grok ids as all six with default medium", () => {
    expect(xaiEffortPolicy(cfg("grok-4"))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: "medium",
    });
  });

  it("returns no levels for image and non-reasoning Grok ids", () => {
    expect(xaiEffortPolicy(cfg("grok-4-fast-non-reasoning"))?.supported).toEqual([]);
    expect(xaiEffortPolicy(cfg("grok-2-image-1212"))?.supported).toEqual([]);
  });
});

describe("getXaiReasoningEffort", () => {
  it("lets native provider_config.reasoning_effort win over model.effort", () => {
    expect(
      getXaiReasoningEffort(
        cfg("grok-4", {
          effort: "ultra",
          provider_config: { model_name: "grok-4", reasoning_effort: "low" },
        })
      )
    ).toBe("low");
  });

  it("maps extra and ultra to high", () => {
    expect(getXaiReasoningEffort(cfg("grok-4", { effort: "extra" }))).toBe("high");
    expect(getXaiReasoningEffort(cfg("grok-4", { effort: "ultra" }))).toBe("high");
  });

  it("returns undefined when neither native nor effort is set", () => {
    expect(getXaiReasoningEffort(cfg("grok-4"))).toBeUndefined();
  });
});
