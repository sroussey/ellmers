/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderTaskOutputRepository } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/**
 * Integration test for the dir-fsync addition on the blob write path.
 *
 * The directory `open()` + `sync()` runs unconditionally after every rename
 * to keep the parent directory's metadata durable on `data=ordered` ext4 (so
 * a crash between the rename and the directory flush cannot publish a name
 * pointing at zero bytes). We can't easily simulate the unsupported-FS error
 * codes (`EPERM` / `EINVAL` / `ENOTSUP` / `EISDIR`) on a Linux tmp dir, so
 * these tests cover the happy path end-to-end:
 *
 *  - the dir-sync code executes on every write without raising,
 *  - bytes round-trip through `getOutputByRef` (proving the rename landed),
 *  - many concurrent writes all complete without any dir-sync interleaving
 *    failure.
 */
describe("FsFolderTaskOutputRepository dir fsync (integration)", () => {
  setLogger(getTestingLogger());
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "fsfolder-dirsync-"));
  });

  afterEach(() => {
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {}
  });

  it("saveOutputStreamPort resolves and bytes round-trip with dir-sync enabled", async () => {
    const repo = new FsFolderTaskOutputRepository(folder);
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const ref = await repo.saveOutputStreamPort(
      "RoundTrip",
      { k: 1 },
      "file",
      "binary",
      once(payload),
      {
        mime: "application/octet-stream",
      }
    );
    expect(ref.$ref).toMatch(/^fsfolder:\/\/blobs\/RoundTrip_/);
    const blob = await repo.getOutputByRef(ref);
    expect(blob).toBeDefined();
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(payload));
  });

  it("16 concurrent writes complete (dir-sync does not serialize incorrectly)", async () => {
    const repo = new FsFolderTaskOutputRepository(folder);
    const refs = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        repo.saveOutputStreamPort(
          "Concurrent",
          { i },
          "file",
          "binary",
          once(new Uint8Array([i])),
          {}
        )
      )
    );
    expect(refs).toHaveLength(16);
    for (let i = 0; i < refs.length; i++) {
      const blob = await repo.getOutputByRef(refs[i]!);
      expect(blob).toBeDefined();
      const bytes = new Uint8Array(await blob!.arrayBuffer());
      expect(Array.from(bytes)).toEqual([i]);
    }
  });
});
