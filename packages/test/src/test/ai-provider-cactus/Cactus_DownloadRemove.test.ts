/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/cactus/ai";
import { afterEach, describe, expect, it } from "vitest";
import { runFnFor } from "./test-utils";

const { cactusConfigJson, cactusEngines } = _testOnly;
const Cactus_DownloadRemove = runFnFor(["model.download-remove"]);

describe("Cactus_DownloadRemove", () => {
  afterEach(() => {
    cactusEngines.clear();
    cactusConfigJson.clear();
  });

  it("drops cached engine and config; emits finish", async () => {
    cactusEngines.set("needle-26m", {} as any);
    cactusConfigJson.set("needle-26m", { fake: true });

    let finished = false;
    const controller = new AbortController();
    await Cactus_DownloadRemove(
      { model: { model_id: "test" } } as any,
      {
        model_id: "test",
        title: "",
        description: "",
        provider: "LOCAL_CACTUS",
        provider_config: { model_id: "needle-26m", models_dir: "/tmp/cactus-test-nonexistent" },
        capabilities: ["tool-use"],
        metadata: {},
      } as any,
      controller.signal,
      (ev) => {
        if (ev.type === "finish") finished = true;
      }
    );
    expect(finished).toBe(true);
    expect(cactusEngines.has("needle-26m")).toBe(false);
    expect(cactusConfigJson.has("needle-26m")).toBe(false);
  });
});
