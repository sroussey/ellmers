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

  it("passes each dispatched row's REAL seq, jumping past skipped gaps", () => {
    // The seq argument is what the client persists as its resume cursor: after
    // a gap-skip it must reflect the true stream position (here 3..5), not a
    // local dispatch count (which would report 2..4 and lag forever).
    const seqs: number[] = [];
    const r = new StreamReassembler((_e, seq) => seqs.push(seq), 0, 2);
    r.push(row(1, "a"));
    r.push(row(3, "c"));
    r.push(row(4, "d"));
    r.push(row(5, "e")); // overflows the gap buffer → seq 2 skipped
    expect(seqs).toEqual([1, 3, 4, 5]);
  });

  it("passes the real seq for buffered rows flushed after a gap fills", () => {
    const seqs: number[] = [];
    const r = new StreamReassembler((_e, seq) => seqs.push(seq));
    r.push(row(2, "b"));
    r.push(row(3, "c"));
    r.push(row(1, "a")); // fills the gap → flush 1,2,3
    expect(seqs).toEqual([1, 2, 3]);
  });
});
