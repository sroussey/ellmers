/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StreamReassembler, type StreamChunkRow } from "@workglow/job-queue";
import { describe, expect, it } from "vitest";

const row = (seq: number, tag: string): StreamChunkRow => ({
  jobId: "j",
  seq,
  event: { type: "text-delta", port: "p", textDelta: tag },
});

describe("StreamReassembler", () => {
  it("dispatches in-order rows immediately", () => {
    const out: string[] = [];
    const r = new StreamReassembler((e) => out.push(e.textDelta as string));
    r.push(row(1, "a"));
    r.push(row(2, "b"));
    r.push(row(3, "c"));
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("buffers out-of-order rows and flushes contiguous runs", () => {
    const out: string[] = [];
    const r = new StreamReassembler((e) => out.push(e.textDelta as string));
    r.push(row(2, "b"));
    r.push(row(3, "c"));
    expect(out).toEqual([]); // waiting on seq 1
    r.push(row(1, "a"));
    expect(out).toEqual(["a", "b", "c"]); // gap filled → flush 1,2,3
  });

  it("drops duplicate/already-delivered rows", () => {
    const out: string[] = [];
    const r = new StreamReassembler((e) => out.push(e.textDelta as string));
    r.push(row(1, "a"));
    r.push(row(1, "a-dup"));
    r.push(row(2, "b"));
    expect(out).toEqual(["a", "b"]);
  });

  it("honors sinceSeq start offset (replay skips delivered prefix)", () => {
    const out: string[] = [];
    const r = new StreamReassembler((e) => out.push(e.textDelta as string), 2);
    r.push(row(1, "old")); // < expected (3) → dropped
    r.push(row(2, "old2")); // < expected → dropped
    r.push(row(3, "c"));
    expect(out).toEqual(["c"]);
  });

  it("skips a permanently-missing seq once the gap buffer overflows (bounded, no stall)", () => {
    const out: string[] = [];
    const r = new StreamReassembler((e) => out.push(e.textDelta as string), 0, 2); // maxGapBuffer = 2
    r.push(row(1, "a"));
    r.push(row(3, "c"));
    r.push(row(4, "d"));
    expect(out).toEqual(["a"]); // gap {3,4} size 2 (not > 2); still waiting on seq 2
    r.push(row(5, "e"));
    // gap {3,4,5} size 3 > 2 → treat seq 2 as dropped, skip and flush 3,4,5
    expect(out).toEqual(["a", "c", "d", "e"]);
    // A late seq 2 is now a duplicate (< expected) and ignored.
    r.push(row(2, "late"));
    expect(out).toEqual(["a", "c", "d", "e"]);
  });
});
