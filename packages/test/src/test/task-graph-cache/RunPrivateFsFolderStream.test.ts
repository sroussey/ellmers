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
import {
  FsFolderTaskOutputRepository,
  getStreamPortCodec,
  isCacheRef,
  makeCacheRef,
  RunPrivateCacheRepo,
} from "@workglow/task-graph";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(typeof streamable.getOutputStreamByRef).toBe("function");

    const tabular = new RunPrivateCacheRepo({
      backing: new RunPrivateInMemoryTaskOutputRepository(),
      runId: "run-A",
    });
    expect(tabular.supportsStreaming()).toBe(false);
    expect(tabular.supportsStreamingPorts()).toBe(false);
    expect(typeof tabular.getOutputStreamByRef).toBe("undefined");
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
    // clearRun also invalidates run-A's ref for run-B's readers: a ref that
    // came from run-A must never resolve against run-B, even after the blob
    // (and its run-A rows) are gone.
    expect(await repoB.getOutputStreamByRef!(refA)).toBeUndefined();
  });

  describe("run-scope enforcement", () => {
    it("does not resolve a ref written by another run", async () => {
      const codec = getStreamPortCodec("append");
      const mk = (t: string): AsyncIterable<Uint8Array> =>
        codec.encode(fromArray([{ type: "text-delta", port: "text", textDelta: t }]), "text");

      const wrapperA = new RunPrivateCacheRepo({ backing, runId: "run-A" });
      const wrapperB = new RunPrivateCacheRepo({ backing, runId: "run-B" });

      const refB = await wrapperB.saveOutputStreamPort!(
        "T",
        { p: 1 },
        "text",
        "append",
        mk("B"),
        {}
      );

      expect(await wrapperA.getOutputStreamByRef!(refB)).toBeUndefined();
      expect(await wrapperA.getOutputByRef!(refB)).toBeUndefined();
    });

    it("does not delete a blob written by another run", async () => {
      const codec = getStreamPortCodec("append");
      const mk = (t: string): AsyncIterable<Uint8Array> =>
        codec.encode(fromArray([{ type: "text-delta", port: "text", textDelta: t }]), "text");

      const wrapperA = new RunPrivateCacheRepo({ backing, runId: "run-A" });
      const wrapperB = new RunPrivateCacheRepo({ backing, runId: "run-B" });

      const refB = await wrapperB.saveOutputStreamPort!(
        "T",
        { p: 1 },
        "text",
        "append",
        mk("B"),
        {}
      );
      const blobsBefore = blobNames(folder).length;

      // Silent no-op: matches the base contract's best-effort idempotency for
      // by-ref delete (missing entries never throw). Foreign-ref alarms belong
      // in operator observability, not on the security-invariant path — a
      // throw here would let a hostile ref crash a legitimate wrapper.
      await expect(wrapperA.deleteOutputByRef!(refB)).resolves.toBeUndefined();

      const back = await wrapperB.getOutputStreamByRef!(refB);
      expect(back).toBeDefined();
      expect(await codec.materialize(back!, "text")).toBe("B");
      expect(blobNames(folder).length).toBe(blobsBefore);
    });

    it("still resolves and deletes refs written by the same run", async () => {
      const codec = getStreamPortCodec("append");
      const wrapperA = new RunPrivateCacheRepo({ backing, runId: "run-A" });

      const refA = await wrapperA.saveOutputStreamPort!(
        "T",
        { p: 1 },
        "text",
        "append",
        codec.encode(fromArray([{ type: "text-delta", port: "text", textDelta: "A" }]), "text"),
        {}
      );
      const before = blobNames(folder).length;

      const stream = await wrapperA.getOutputStreamByRef!(refA);
      expect(stream).toBeDefined();
      expect(await codec.materialize(stream!, "text")).toBe("A");
      const blob = await wrapperA.getOutputByRef!(refA);
      expect(blob).toBeDefined();

      await wrapperA.deleteOutputByRef!(refA);

      expect(await wrapperA.getOutputStreamByRef!(refA)).toBeUndefined();
      expect(await wrapperA.getOutputByRef!(refA)).toBeUndefined();
      expect(blobNames(folder).length).toBe(before - 1);
    });

    describe("prefix-boundary collision", () => {
      it.each([
        ["session1", "session1-"],
        ["run-1", "run-1:x"],
        ["x", "x-y"],
        // Same-length sanitize collision: a scheme embedding the raw runId in
        // blob names would sanitize both of these to the same `a-b`, merging
        // the two runs' namespaces; the hex prefix keeps them distinct.
        ["a:b", "a-b"],
      ])("victim=%s cannot access blobs written by attacker=%s", async (victimId, attackerId) => {
        const codec = getStreamPortCodec("append");
        const mk = (t: string): AsyncIterable<Uint8Array> =>
          codec.encode(fromArray([{ type: "text-delta", port: "text", textDelta: t }]), "text");

        const victim = new RunPrivateCacheRepo({ backing, runId: victimId });
        const attacker = new RunPrivateCacheRepo({ backing, runId: attackerId });

        const attackerRef = await attacker.saveOutputStreamPort!(
          "T",
          { p: 1 },
          "text",
          "append",
          mk("attacker"),
          {}
        );
        const blobsBefore = blobNames(folder).length;

        // (a) The victim cannot read the attacker's blob through either reader.
        expect(await victim.getOutputStreamByRef!(attackerRef)).toBeUndefined();
        expect(await victim.getOutputByRef!(attackerRef)).toBeUndefined();

        // (b) The victim's delete is a no-op — the blob count is unchanged
        // and the attacker's blob still resolves through its own wrapper.
        await expect(victim.deleteOutputByRef!(attackerRef)).resolves.toBeUndefined();
        expect(blobNames(folder).length).toBe(blobsBefore);

        const roundTrip = await attacker.getOutputStreamByRef!(attackerRef);
        expect(roundTrip).toBeDefined();
        expect(await codec.materialize(roundTrip!, "text")).toBe("attacker");

        // (c) The attacker can still round-trip its own ref.
        const ownRef = await attacker.saveOutputStreamPort!(
          "T",
          { p: 2 },
          "text",
          "append",
          mk("attacker-own"),
          {}
        );
        const ownStream = await attacker.getOutputStreamByRef!(ownRef);
        expect(ownStream).toBeDefined();
        expect(await codec.materialize(ownStream!, "text")).toBe("attacker-own");
      });
    });

    it("uniformly rejects malformed and foreign-scheme refs", async () => {
      const wrapperA = new RunPrivateCacheRepo({ backing, runId: "run-A" });

      // Well-formed fsfolder URI but with no run-scope prefix in the blob name:
      // could only exist as a deterministic-tier write; the wrapper must not
      // resolve it against run-A.
      const unscoped = makeCacheRef({ $ref: "fsfolder://blobs/foreign.bin" });
      // Foreign URI scheme entirely — never a fsfolder blob.
      const foreign = makeCacheRef({ $ref: "other://something" });

      expect(await wrapperA.getOutputStreamByRef!(unscoped)).toBeUndefined();
      expect(await wrapperA.getOutputByRef!(unscoped)).toBeUndefined();
      await expect(wrapperA.deleteOutputByRef!(unscoped)).resolves.toBeUndefined();

      expect(await wrapperA.getOutputStreamByRef!(foreign)).toBeUndefined();
      expect(await wrapperA.getOutputByRef!(foreign)).toBeUndefined();
      await expect(wrapperA.deleteOutputByRef!(foreign)).resolves.toBeUndefined();
    });
  });
});
