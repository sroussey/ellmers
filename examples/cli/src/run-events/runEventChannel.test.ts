/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getRunEventSink,
  installRunEventChannel,
  readRunAnswerLines,
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

describe("readRunAnswerLines", () => {
  it("delivers whole lines and ignores a partial tail", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "wg-answers-")), "answers.ndjson");
    writeFileSync(file, '{"requestId":"a"}\n{"requestId":"b"}\n{"partial"', "utf8");
    const lines: string[] = [];
    const stop = readRunAnswerLines(`file:${file}`, (line) => lines.push(line));
    expect(stop).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 100));
    stop!();
    expect(lines).toEqual(['{"requestId":"a"}', '{"requestId":"b"}']);
  });

  it("is absent when nothing is answering", () => {
    expect(readRunAnswerLines("", () => {})).toBeUndefined();
    expect(readRunAnswerLines("nonsense", () => {})).toBeUndefined();
  });
});
