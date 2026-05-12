/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

type MemSnap = ReturnType<typeof process.memoryUsage>;

export interface TimingSnap {
  readonly started: number;
  readonly mem: MemSnap;
}

const mb = (n: number) => Math.round(n / 1024 / 1024) + "MB";
const diff = (cur: number, base: number) => (cur >= base ? "+" : "") + mb(cur - base);

/** Only log when duration or memory delta (either direction) crosses these. */
const NOTABLE_ELAPSED_SEC = 1;
const NOTABLE_RSS_BYTES = 8 * 1024 * 1024;
const NOTABLE_HEAP_BYTES = 8 * 1024 * 1024;
const NOTABLE_EXTERNAL_BYTES = 4 * 1024 * 1024;

export const snap = (): TimingSnap => ({ started: Date.now(), mem: process.memoryUsage() });

export const report = (label: string, s: TimingSnap): void => {
  const m = process.memoryUsage();
  const elapsedSec = (Date.now() - s.started) / 1000;
  const rssDelta = m.rss - s.mem.rss;
  const heapDelta = m.heapUsed - s.mem.heapUsed;
  const extDelta = m.external - s.mem.external;

  const notableTime = elapsedSec >= NOTABLE_ELAPSED_SEC;
  const notableMem =
    Math.abs(rssDelta) >= NOTABLE_RSS_BYTES ||
    Math.abs(heapDelta) >= NOTABLE_HEAP_BYTES ||
    Math.abs(extDelta) >= NOTABLE_EXTERNAL_BYTES;

  if (!notableTime && !notableMem) {
    return;
  }

  const elapsed = elapsedSec.toFixed(2);
  process.stderr.write(
    `[${label}] ${elapsed}s  rss=${mb(m.rss)}(${diff(m.rss, s.mem.rss)}) heap=${mb(m.heapUsed)}(${diff(m.heapUsed, s.mem.heapUsed)}) ext=${mb(m.external)}(${diff(m.external, s.mem.external)})\n`
  );
};
