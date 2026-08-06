/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";
import type { StreamChunkRow, StreamEventLike } from "./JobQueueEventListeners";

/**
 * Default cap on how many out-of-order rows the reassembler holds while waiting
 * for a missing `seq`. Once exceeded, the missing seq(s) are treated as dropped
 * and skipped so delivery resumes and the buffer stays bounded. High enough that
 * ordinary carrier reordering never trips it.
 */
export const DEFAULT_MAX_GAP_BUFFER = 1024;

/**
 * Turns a stream of possibly-out-of-order, possibly-overlapping
 * {@link StreamChunkRow}s into an in-order, de-duplicated event callback.
 *
 * Rows carry a monotonic 1-based `seq`. A row at the expected seq is dispatched
 * immediately and pulls any contiguous buffered successors; a future seq is
 * held in a gap buffer; an already-delivered seq is dropped. This keeps the
 * cross-process channel correct even when a carrier delivers rows reordered,
 * while staying a trivial pass-through for an in-order carrier.
 *
 * `dispatch` receives the row's own `seq` alongside the event so consumers can
 * track the true delivered position (a gap-skip jumps `seq` past the dropped
 * rows — a locally-counted cursor would lag behind it forever).
 *
 * A carrier may also *drop* a row (best-effort publish). To avoid stalling the
 * whole stream forever on a seq that never arrives — and to keep the gap buffer
 * bounded — once more than {@link maxGapBuffer} rows pile up ahead of the gap,
 * the missing seq(s) are skipped (logged) and delivery resumes from the lowest
 * buffered row.
 */
export class StreamReassembler {
  private expectedSeq: number;
  private readonly gap = new Map<number, StreamChunkRow>();

  constructor(
    private readonly dispatch: (event: StreamEventLike, seq: number) => void,
    sinceSeq: number = 0,
    private readonly maxGapBuffer: number = DEFAULT_MAX_GAP_BUFFER
  ) {
    this.expectedSeq = sinceSeq + 1;
  }

  push(row: StreamChunkRow): void {
    if (row.seq < this.expectedSeq) return; // duplicate / already delivered
    if (row.seq > this.expectedSeq) {
      this.gap.set(row.seq, row); // wait for the missing predecessors
      if (this.gap.size > this.maxGapBuffer) this.skipGaps();
      return;
    }
    this.dispatch(row.event, row.seq);
    this.expectedSeq++;
    this.flushContiguous();
  }

  /** Dispatch buffered rows contiguous with `expectedSeq`, advancing it. */
  private flushContiguous(): void {
    let next = this.gap.get(this.expectedSeq);
    while (next) {
      this.gap.delete(this.expectedSeq);
      this.dispatch(next.event, next.seq);
      this.expectedSeq++;
      next = this.gap.get(this.expectedSeq);
    }
  }

  /**
   * Recover liveness when a dropped seq has stalled delivery: jump `expectedSeq`
   * to the lowest buffered row and flush from there, repeating until the buffer
   * is back within {@link maxGapBuffer}. The skipped seqs are lost (the point —
   * the carrier dropped them) and logged for operator visibility.
   */
  private skipGaps(): void {
    while (this.gap.size > this.maxGapBuffer) {
      let lowest = Infinity;
      for (const seq of this.gap.keys()) if (seq < lowest) lowest = seq;
      if (!Number.isFinite(lowest)) return;
      getLogger().warn("StreamReassembler skipping dropped stream rows", {
        from: this.expectedSeq,
        to: lowest,
        buffered: this.gap.size,
      });
      this.expectedSeq = lowest;
      this.flushContiguous();
    }
  }
}
