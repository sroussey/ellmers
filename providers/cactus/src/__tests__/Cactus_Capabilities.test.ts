/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai/worker";
import { describe, expect, it } from "vitest";
import { inferCactusCapabilities } from "../ai/common/Cactus_Capabilities";

function model(): ModelRecord {
  return {
    model_id: "test",
    title: "test",
    description: "",
    provider: "LOCAL_CACTUS",
    provider_config: { model_id: "needle-26m" },
    capabilities: [],
    metadata: {},
  } as ModelRecord;
}

describe("inferCactusCapabilities", () => {
  it("always returns the full Cactus capability set", () => {
    const caps = inferCactusCapabilities(model());
    expect(caps).toEqual([
      "tool-use",
      "model.download",
      "model.download-remove",
      "model.search",
      "model.info",
    ]);
  });
});
