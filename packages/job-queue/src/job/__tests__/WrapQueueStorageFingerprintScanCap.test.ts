/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryQueueStorage, wrapQueueStorage } from "@workglow/job-queue";
import { describe, expect, it } from "vitest";

interface TI {
  readonly data?: string;
}
interface TO {
  readonly result?: string;
}

async function seedFiveJobs(storage: InMemoryQueueStorage<TI, TO>): Promise<void> {
  // Insert 5 PENDING jobs with distinct fingerprints, in order fp-0..fp-4.
  // InMemoryQueueStorage.peek() sorts by visible_at with a stable sort, so
  // insertion order is preserved when timestamps tie.
  for (let i = 0; i < 5; i++) {
    await storage.add({
      input: { data: `job-${i}` },
      fingerprint: `fp-${i}`,
      visible_at: null,
      completed_at: null,
      deadline_at: null,
    } as any);
  }
}

/**
 * InMemoryQueueStorage implements findActiveByFingerprint natively (an
 * unbounded Array.find), so WrappedJobStore.findActiveByFingerprint would
 * delegate straight to it and never exercise the wrapper's bounded-scan
 * fallback. Shadowing the method with an own-property `undefined` hides the
 * native implementation from `typeof storage.findActiveByFingerprint ===
 * "function"`, forcing the wrapper down its peek-and-scan fallback path so
 * maxFingerprintScan is actually exercised.
 */
function disableNativeFingerprintLookup(storage: InMemoryQueueStorage<TI, TO>): void {
  (storage as { findActiveByFingerprint?: unknown }).findActiveByFingerprint = undefined;
}

describe("wrapQueueStorage maxFingerprintScan override", () => {
  it("does not find a fingerprint past the configured maxFingerprintScan", async () => {
    const queueName = "fp-scan-cap-queue-low";
    const storage = new InMemoryQueueStorage<TI, TO>(queueName);
    disableNativeFingerprintLookup(storage);
    const { jobStore } = wrapQueueStorage(storage, { maxFingerprintScan: 2 });
    await seedFiveJobs(storage);

    // fp-3 is the 4th inserted job; a cap of 2 only scans fp-0 and fp-1.
    const result = await jobStore.findActiveByFingerprint("fp-3", queueName);
    expect(result).toBeUndefined();
  });

  it("finds a fingerprint within the configured maxFingerprintScan", async () => {
    const queueName = "fp-scan-cap-queue-high";
    const storage = new InMemoryQueueStorage<TI, TO>(queueName);
    disableNativeFingerprintLookup(storage);
    const { jobStore } = wrapQueueStorage(storage, { maxFingerprintScan: 10 });
    await seedFiveJobs(storage);

    // Same fp-3 target, but the cap is now large enough to reach it — proves
    // the low-cap case above is actually exercising the cap, not some other
    // failure mode (e.g. the fallback path being unreachable).
    const result = await jobStore.findActiveByFingerprint("fp-3", queueName);
    expect(result?.fingerprint).toBe("fp-3");
  });
});
