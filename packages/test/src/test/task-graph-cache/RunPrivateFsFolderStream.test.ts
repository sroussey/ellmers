/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run-private cache tier can stream when backed by a sidecar-capable
 * repository. `FsFolderTaskOutputRepository` implements the run-scoped
 * `*ForRun` contract (rows + streaming), so wrapping it in
 * `RunPrivateCacheRepo` forwards streaming end to end: each streamed port lands
 * as a run-namespaced sidecar blob, reads back through the wrapper's by-ref
 * readers, and `clearRun()` reclaims both the run's rows and its blobs. A
 * tabular (no-sidecar) run-private backing leaves the streaming surface
 * undefined and the tier degrades to accumulation, unchanged.
 */

import type { StreamEvent } from "@workglow/task-graph";
import { getStreamPortCodec, isCacheRef, RunPrivateCacheRepo } from "@workglow/task-graph";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsFolderTaskOutputRepository } from "../../binding/FsFolderTaskOutputRepository";
import { RunPrivateInMemoryTaskOutputRepository } from "../../binding/RunPrivateInMemoryTaskOutputRepository";

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const it of items) yield it;
}

function blobNames(folder: string): string[] {
  try {
    return readdirSync(join(folder, "blobs")).filter((n) => n.endsWith(".bin"));
  } catch {
    return [];
  }
}

describe("run-private streaming over an FsFolder backing", () => {
  let folder: string;
  let backing: FsFolderTaskOutputRepository;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "runprivate-fsfolder-"));
    backing = new FsFolderTaskOutputRepository(folder);
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("reports streaming capability only for a sidecar-capable backing", () => {
    const streamable = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    expect(streamable.supportsStreaming()).toBe(true);
    expect(streamable.supportsStreamingPorts()).toBe(true);
    expect(streamable.supportsStreamingReads()).toBe(true);

    const tabular = new RunPrivateCacheRepo({
      backing: new RunPrivateInMemoryTaskOutputRepository(),
      runId: "run-A",
    });
    expect(tabular.supportsStreaming()).toBe(false);
    expect(tabular.supportsStreamingPorts()).toBe(false);
    expect(tabular.supportsStreamingReads()).toBe(false);
  });

  it("round-trips a streamed port through the wrapper's by-ref readers", async () => {
    const repo = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    const codec = getStreamPortCodec("append");
    const events: StreamEvent[] = [
      { type: "text-delta", port: "text", textDelta: "Bon" },
      { type: "text-delta", port: "text", textDelta: "jour" },
    ];

    const ref = await repo.saveOutputStreamPort!(
      "T",
      { p: 1 },
      "text",
      "append",
      codec.encode(fromArray(events), "text"),
      {}
    );
    expect(isCacheRef(ref)).toBe(true);
    expect(ref.port).toBe("text");
    expect(ref.mode).toBe("append");

    const back = await repo.getOutputStreamByRef!(ref);
    expect(back).toBeDefined();
    expect(await codec.materialize(back!, "text")).toBe("Bonjour");
  });

  it("namespaces streamed blobs by runId so two runs with the same key don't collide", async () => {
    const codec = getStreamPortCodec("append");
    const mk = (t: string): AsyncIterable<Uint8Array> =>
      codec.encode(fromArray([{ type: "text-delta", port: "text", textDelta: t }]), "text");

    const repoA = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    const repoB = new RunPrivateCacheRepo({ backing, runId: "run-B" });

    const refA = await repoA.saveOutputStreamPort!("T", { p: 1 }, "text", "append", mk("A"), {});
    const refB = await repoB.saveOutputStreamPort!("T", { p: 1 }, "text", "append", mk("B"), {});

    expect(refA.$ref).not.toBe(refB.$ref);
    expect(await codec.materialize((await repoA.getOutputStreamByRef!(refA))!, "text")).toBe("A");
    expect(await codec.materialize((await repoB.getOutputStreamByRef!(refB))!, "text")).toBe("B");
    expect(blobNames(folder)).toHaveLength(2);
  });

  it("clearRun() reclaims the run's output rows and its sidecar blobs, leaving other runs intact", async () => {
    const codec = getStreamPortCodec("append");
    const mk = (t: string): AsyncIterable<Uint8Array> =>
      codec.encode(fromArray([{ type: "text-delta", port: "text", textDelta: t }]), "text");

    const repoA = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    const repoB = new RunPrivateCacheRepo({ backing, runId: "run-B" });

    // Each run writes a row (via saveOutput) and a streamed sidecar blob.
    await repoA.saveOutput("T", { p: 1 }, { ok: "A" });
    await repoB.saveOutput("T", { p: 1 }, { ok: "B" });
    const refA = await repoA.saveOutputStreamPort!("T", { p: 1 }, "text", "append", mk("A"), {});
    await repoB.saveOutputStreamPort!("T", { p: 1 }, "text", "append", mk("B"), {});

    expect(await repoA.size()).toBe(1);
    expect(blobNames(folder)).toHaveLength(2);

    await repoA.clearRun();

    // Run A's row and blob are gone; the ref no longer resolves.
    expect(await repoA.getOutput("T", { p: 1 })).toBeUndefined();
    expect(await repoA.size()).toBe(0);
    expect(repoA.getOutputStreamByRef!(refA)).toBeUndefined();

    // Run B is untouched: its row still reads and its blob survives.
    expect(await repoB.getOutput("T", { p: 1 })).toEqual({ ok: "B" });
    expect(await repoB.size()).toBe(1);
    expect(blobNames(folder)).toHaveLength(1);
  });
});
