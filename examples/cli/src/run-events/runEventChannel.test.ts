/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getRunEventSink,
  installRunEventChannel,
  resetRunEventChannelForTesting,
} from "./runEventChannel";

afterEach(() => resetRunEventChannelForTesting());

describe("run event channel", () => {
  it("writes one NDJSON line per event and is retrievable globally", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "wg-events-")), "events.ndjson");
    const sink = installRunEventChannel(`file:${file}`);
    expect(sink).toBeDefined();
    expect(getRunEventSink()).toBe(sink);
    sink!.emit({ k: "status", id: "t1", status: "PROCESSING" });
    sink!.emit({ k: "progress", id: "t1", progress: 42, message: "halfway" });
    await sink!.close();
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ k: "status", id: "t1", status: "PROCESSING" });
    expect(JSON.parse(lines[1]).progress).toBe(42);
  });

  it("is absent when nothing asked for it", () => {
    expect(installRunEventChannel("")).toBeUndefined();
    expect(installRunEventChannel("nonsense")).toBeUndefined();
    expect(getRunEventSink()).toBeUndefined();
  });

  it("never lets a broken channel take the run down with it", () => {
    const sink = installRunEventChannel("file:/nonexistent-dir/events.ndjson");
    expect(() => sink?.emit({ k: "status", id: "t1", status: "FAILED" })).not.toThrow();
  });
});
