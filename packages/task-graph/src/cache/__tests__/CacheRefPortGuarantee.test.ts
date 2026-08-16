/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `ICacheRef.port` is optional on the type because rows persisted by older
 * releases carry no port. That tolerance belongs to the READ side only: the one
 * writer surface a backing implements today — `saveOutputStreamPort` and its
 * run-scoped counterpart — takes the port as a required parameter, so every ref
 * a backing mints must carry it. Pinned here for the filesystem backing, the
 * in-memory testing backing, the shared chunked-blob base, and the run-private
 * wrapper that forwards to a run-scoped writer.
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import type { CacheRef, ITaskOutputStorage, StreamMode } from "@workglow/task-graph";
import {
  FsFolderTaskOutputRepository,
  isCacheRef,
  RunPrivateCacheRepo,
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
} from "@workglow/task-graph";
import type { IBlobChunkStore } from "@workglow/task-graph/test";
import {
  StreamingMemoryRepo,
  TabularStreamingTaskOutputRepository,
} from "@workglow/task-graph/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Minimal in-memory {@link IBlobChunkStore} so the shared base needs no database. */
class MemoryBlobChunkStore implements IBlobChunkStore {
  private readonly payloads = new Map<string, Uint8Array>();
  async setup(): Promise<void> {}
  async writeStream(refKey: string, chunks: AsyncIterable<Uint8Array>): Promise<number> {
    const bytes: number[] = [];
    for await (const chunk of chunks) for (const b of chunk) bytes.push(b);
    this.payloads.set(refKey, Uint8Array.from(bytes));
    return bytes.length;
  }
  async readBlob(refKey: string): Promise<Blob | undefined> {
    const bytes = this.payloads.get(refKey);
    return bytes === undefined ? undefined : new Blob([bytes as unknown as BlobPart]);
  }
  async readStream(refKey: string): Promise<AsyncIterable<Uint8Array> | undefined> {
    const bytes = this.payloads.get(refKey);
    if (bytes === undefined) return undefined;
    return (async function* () {
      yield bytes;
    })();
  }
  async deleteRef(refKey: string): Promise<void> {
    this.payloads.delete(refKey);
  }
  async clear(): Promise<void> {
    this.payloads.clear();
  }
  async pruneOlderThan(): Promise<void> {}
}

class MemoryTabularStreamingRepo extends TabularStreamingTaskOutputRepository {
  constructor() {
    super({ storage: memoryOutputStorage(), blobs: new MemoryBlobChunkStore(), scheme: "memblob" });
  }
}

function memoryOutputStorage(): ITaskOutputStorage {
  return tabularTaskOutputStorage(
    new InMemoryTabularStorage(TaskOutputSchema, TaskOutputPrimaryKeyNames, ["createdAt"])
  );
}

async function* oneChunk(): AsyncIterable<Uint8Array> {
  yield Uint8Array.from([1, 2, 3]);
}

/** Every streamable mode, each with a port name distinct from the mode. */
const CASES: ReadonlyArray<{ readonly port: string; readonly mode: StreamMode }> = [
  { port: "transcript", mode: "append" },
  { port: "records", mode: "object" },
  { port: "artifact", mode: "binary" },
];

interface PortWriter {
  saveOutputStreamPort?: (
    taskType: string,
    inputs: Record<string, unknown>,
    port: string,
    mode: StreamMode,
    chunks: AsyncIterable<Uint8Array>,
    metadata: Record<string, unknown>
  ) => Promise<CacheRef>;
}

function expectsPortOnEveryRef(name: string, makeRepo: () => PortWriter): void {
  describe(name, () => {
    for (const { port, mode } of CASES) {
      it(`stamps the port on a ${mode} ref`, async () => {
        const repo = makeRepo();
        const ref = await repo.saveOutputStreamPort!("T", { k: 1 }, port, mode, oneChunk(), {});
        expect(isCacheRef(ref)).toBe(true);
        expect(ref.port).toBe(port);
        expect(ref.mode).toBe(mode);
      });
    }

    it("gives two ports of one (taskType, inputs) their own port-tagged refs", async () => {
      const repo = makeRepo();
      const a = await repo.saveOutputStreamPort!("T", { k: 2 }, "left", "append", oneChunk(), {});
      const b = await repo.saveOutputStreamPort!("T", { k: 2 }, "right", "binary", oneChunk(), {});
      expect(a.port).toBe("left");
      expect(b.port).toBe("right");
      expect(a.$ref).not.toBe(b.$ref);
    });
  });
}

describe("every minted CacheRef carries its port", () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "cacheref-port-"));
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  expectsPortOnEveryRef(
    "FsFolderTaskOutputRepository",
    () => new FsFolderTaskOutputRepository(folder)
  );
  expectsPortOnEveryRef("StreamingMemoryRepo", () => new StreamingMemoryRepo({}));
  expectsPortOnEveryRef(
    "TabularStreamingTaskOutputRepository",
    () => new MemoryTabularStreamingRepo()
  );
  expectsPortOnEveryRef(
    "RunPrivateCacheRepo over a run-scoped stream writer",
    () =>
      new RunPrivateCacheRepo({
        backing: new FsFolderTaskOutputRepository(folder),
        runId: "run-1",
      }) as PortWriter
  );
});
