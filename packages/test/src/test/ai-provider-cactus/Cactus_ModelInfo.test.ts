/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelInfoTaskOutput } from "@workglow/ai";
import { describe, expect, it } from "vitest";
import { runFnFor } from "./test-utils";

const Cactus_ModelInfo = runFnFor(["model.info"]);

describe("Cactus_ModelInfo", () => {
  it("emits a finish with local+browser+node, not-cached, not-loaded when fresh", async () => {
    let data: ModelInfoTaskOutput | undefined;
    const controller = new AbortController();
    await Cactus_ModelInfo(
      {
        model: {
          model_id: "x",
          title: "x",
          description: "",
          provider: "LOCAL_CACTUS",
          provider_config: { model_id: "needle-26m" },
          capabilities: ["tool-use"],
          metadata: {},
        },
        detail: "files_with_metadata",
      } as any,
      {
        model_id: "x",
        title: "x",
        description: "",
        provider: "LOCAL_CACTUS",
        provider_config: { model_id: "needle-26m" },
        capabilities: ["tool-use"],
        metadata: {},
      } as any,
      controller.signal,
      (ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }
    );
    expect(data?.is_local).toBe(true);
    expect(data?.supports_browser).toBe(true);
    expect(data?.supports_node).toBe(true);
    expect(data?.is_loaded).toBe(false);
  });
});
