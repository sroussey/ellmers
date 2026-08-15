/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderTaskOutputRepository } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Re-use the package surface for `makeCacheRef` so the legacy-compat test can
// synthesize a ref pointing at a file the test placed on disk directly.
import { makeCacheRef } from "@workglow/task-graph";

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

const refToBlobName = (ref: { $ref: string }): string => {
  const m = /^fsfolder:\/\/blobs\/([^/]+)$/.exec(ref.$ref);
  if (!m) throw new Error(`unexpected ref shape: ${ref.$ref}`);
  return m[1]!;
};

describe("FsFolderTaskOutputRepository concurrent-write safety", () => {
  setLogger(getTestingLogger());
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "fsfolder-concurrent-"));
  });

  afterEach(() => {
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {}
  });

  it("two concurrent writers with the same (taskType, inputs) produce distinct refs that both resolve", async () => {
    const repo = new FsFolderTaskOutputRepository(folder);
    const taskType = "SameInputs";
    const inputs = { key: "shared" };
    const payloadA = new Uint8Array([1, 1, 1]);
    const payloadB = new Uint8Array([2, 2, 2]);
    const [refA, refB] = await Promise.all([
      repo.saveOutputStreamPort(taskType, inputs, "file", "binary", once(payloadA), {}),
      repo.saveOutputStreamPort(taskType, inputs, "file", "binary", once(payloadB), {}),
    ]);
    // Distinct paths — no race on a shared blob name.
    expect(refA.$ref).not.toBe(refB.$ref);
    // Sanitized-taskType prefix preserved so prefix-scoped pruning still
    // cascades to both blobs.
    expect(refToBlobName(refA)).toMatch(/^SameInputs_/);
    expect(refToBlobName(refB)).toMatch(/^SameInputs_/);
    // Both blobs are independently readable.
    const blobA = await repo.getOutputByRef(refA);
    const blobB = await repo.getOutputByRef(refB);
    expect(blobA).toBeDefined();
    expect(blobB).toBeDefined();
    expect(Array.from(new Uint8Array(await blobA!.arrayBuffer()))).toEqual(Array.from(payloadA));
    expect(Array.from(new Uint8Array(await blobB!.arrayBuffer()))).toEqual(Array.from(payloadB));
  });

  it("A's failed-row cleanup (deleteOutputByRef) does not delete B's blob", async () => {
    const repo = new FsFolderTaskOutputRepository(folder);
    const taskType = "RaceCleanup";
    const inputs = { id: 1 };
    // Writer A runs, gets a ref.
    const payloadA = new Uint8Array([9, 9, 9]);
    const refA = await repo.saveOutputStreamPort(
      taskType,
      inputs,
      "file",
      "binary",
      once(payloadA),
      {}
    );
    // Writer B runs (same inputs), gets a different ref because of the
    // per-write UUID suffix.
    const payloadB = new Uint8Array([4, 5, 6]);
    const refB = await repo.saveOutputStreamPort(
      taskType,
      inputs,
      "file",
      "binary",
      once(payloadB),
      {}
    );
    expect(refA.$ref).not.toBe(refB.$ref);
    // Simulate A's row-commit failure cleanup: delete A's blob.
    await repo.deleteOutputByRef(refA);
    // A's blob is gone …
    const blobA = await repo.getOutputByRef(refA);
    expect(blobA).toBeUndefined();
    // … but B's blob is still readable, with the right bytes. This is the
    // race the unique suffix exists to fix: without it, A and B would have
    // collided on a single path and A's cleanup would have unlinked B's
    // payload.
    const blobB = await repo.getOutputByRef(refB);
    expect(blobB).toBeDefined();
    expect(Array.from(new Uint8Array(await blobB!.arrayBuffer()))).toEqual(Array.from(payloadB));
  });

  it("backward compat: a legacy un-suffixed blob is still resolvable through getOutputByRef", async () => {
    const repo = new FsFolderTaskOutputRepository(folder);
    // Synthesize a legacy blob path: `<taskType>_<fingerprint>.bin` (no UUID
    // suffix). The exact fingerprint doesn't matter — we just need a name
    // that matches the public ref pattern.
    const legacyName = "LegacyTask_abcdef0123456789.bin";
    const blobsDir = join(folder, "blobs");
    // First, force the repo to lazily create the blobs dir by issuing one
    // write so the directory exists; then drop a legacy file in there.
    await repo.saveOutputStreamPort(
      "Bootstrap",
      {},
      "file",
      "binary",
      once(new Uint8Array([0])),
      {}
    );
    const legacyBytes = new Uint8Array([7, 7, 7, 7]);
    writeFileSync(join(blobsDir, legacyName), legacyBytes);
    const legacyRef = makeCacheRef({
      $ref: `fsfolder://blobs/${legacyName}`,
      size: legacyBytes.byteLength,
    });
    const legacyBlob = await repo.getOutputByRef(legacyRef);
    expect(legacyBlob).toBeDefined();
    expect(Array.from(new Uint8Array(await legacyBlob!.arrayBuffer()))).toEqual(
      Array.from(legacyBytes)
    );
  });
});
