/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/cactus/ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFnFor } from "./test-utils";

const { cactusConfigJson, cactusEngines } = _testOnly;
const Cactus_Download = runFnFor(["model.download"]);

const RUN = process.env.RUN_CACTUS_TESTS === "1";

describe.skipIf(!RUN)("Cactus_Download (integration)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cactus-download-"));
    cactusEngines().clear();
    cactusConfigJson().clear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("downloads all three assets and emits monotonically increasing progress", async () => {
    const progress: number[] = [];
    let finished = false;
    const controller = new AbortController();
    await Cactus_Download(
      { model: { model_id: "test" } } as any,
      {
        model_id: "test",
        title: "",
        description: "",
        provider: "LOCAL_CACTUS",
        provider_config: { model_id: "needle-26m", models_dir: dir },
        capabilities: ["tool-use"],
        metadata: {},
      } as any,
      controller.signal,
      (ev) => {
        if (ev.type === "phase" && typeof ev.progress === "number") progress.push(ev.progress);
        if (ev.type === "finish") finished = true;
      }
    );
    expect(finished).toBe(true);
    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  }, 120_000);
});
