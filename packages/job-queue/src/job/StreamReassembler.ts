/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamChunkRow, StreamEventLike } from "./JobQueueEventListeners";

/**
 * Turns a stream of possibly-out-of-order, possibly-overlapping
 * {@link StreamChunkRow}s into an in-order, de-duplicated event callback.
 *
 * Rows carry a monotonic 1-based `seq`. A row at the expected seq is dispatched
 * immediately and pulls any contiguous buffered successors; a future seq is
 * held in a gap buffer; an already-delivered seq is dropped. This keeps the
 * cross-process channel correct even when a carrier delivers rows reordered,
 * while staying a trivial pass-through for an in-order carrier.
 */
export class StreamReassembler {
  private expectedSeq: number;
  private readonly gap = new Map<number, StreamChunkRow>();

  constructor(
    private readonly dispatch: (event: StreamEventLike) => void,
    sinceSeq: number = 0
  ) {
    this.expectedSeq = sinceSeq + 1;
  }

  push(row: StreamChunkRow): void {
    if (row.seq < this.expectedSeq) return; // duplicate / already delivered
    if (row.seq > this.expectedSeq) {
      this.gap.set(row.seq, row); // wait for the missing predecessors
      return;
    }
    this.dispatch(row.event);
    this.expectedSeq++;
    let next = this.gap.get(this.expectedSeq);
    while (next) {
      this.gap.delete(this.expectedSeq);
      this.dispatch(next.event);
      this.expectedSeq++;
      next = this.gap.get(this.expectedSeq);
    }
  }
}
