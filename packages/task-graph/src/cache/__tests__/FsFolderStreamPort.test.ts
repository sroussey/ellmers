/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `FsFolderTaskOutputRepository.saveOutputStreamPort` persists one output port's
 * codec-encoded byte stream as a sidecar blob and returns a port/mode-tagged
 * CacheRef. The bytes read back through the existing `getOutputStreamByRef` /
 * `getOutputByRef` readers and decode/materialize to the original value. Several
 * ports under the same `(taskType, inputs)` land at distinct files.
 */

import type { StreamEvent } from "@workglow/task-graph";
import { FsFolderTaskOutputRepository, getStreamPortCodec, isCacheRef } from "@workglow/task-graph";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const it of items) yield it;
}

describe("FsFolderTaskOutputRepository.saveOutputStreamPort", () => {
  let folder: string;
  let repo: FsFolderTaskOutputRepository;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "fsfolder-streamport-"));
    repo = new FsFolderTaskOutputRepository(folder);
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("round-trips an append (text) port through a ref", async () => {
    const codec = getStreamPortCodec("append");
    const events: StreamEvent[] = [
      { type: "text-delta", port: "text", textDelta: "Bonjour" },
      { type: "text-delta", port: "text", textDelta: " monde" },
    ];
    const ref = await repo.saveOutputStreamPort(
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
    expect(ref.size).toBeGreaterThan(0);

    const back = await repo.getOutputStreamByRef(ref);
    expect(back).toBeDefined();
    expect(await codec.materialize(back!, "text")).toBe("Bonjour monde");
  });

  it("round-trips an object (NDJSON) port through a ref", async () => {
    const codec = getStreamPortCodec("object");
    const events: StreamEvent[] = [
      { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "a" }] },
      { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "b" }] },
      { type: "object-delta", port: "items", objectDelta: [{ id: 2, v: "c" }] },
    ];
    const ref = await repo.saveOutputStreamPort(
      "T",
      { p: 1 },
      "items",
      "object",
      codec.encode(fromArray(events), "items"),
      {}
    );
    expect(ref.mode).toBe("object");
    const back = await repo.getOutputStreamByRef(ref);
    expect(await codec.materialize(back!, "items")).toEqual([
      { id: 1, v: "b" },
      { id: 2, v: "c" },
    ]);
  });

  it("round-trips a binary port through a ref (also via getOutputByRef Blob)", async () => {
    const codec = getStreamPortCodec("binary");
    const events: StreamEvent[] = [
      { type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([10, 20]) },
      { type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([30]) },
    ];
    const ref = await repo.saveOutputStreamPort(
      "T",
      { p: 1 },
      "file",
      "binary",
      codec.encode(fromArray(events), "file"),
      {}
    );
    const blob = await repo.getOutputByRef(ref);
    expect(blob).toBeDefined();
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([10, 20, 30]);
  });

  it("keeps distinct ports of the same (taskType, inputs) at distinct refs", async () => {
    const text = getStreamPortCodec("append");
    const bin = getStreamPortCodec("binary");
    const a = await repo.saveOutputStreamPort(
      "T",
      { p: 9 },
      "text",
      "append",
      text.encode(fromArray([{ type: "text-delta", port: "text", textDelta: "x" }]), "text"),
      {}
    );
    const b = await repo.saveOutputStreamPort(
      "T",
      { p: 9 },
      "file",
      "binary",
      bin.encode(
        fromArray([{ type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([1]) }]),
        "file"
      ),
      {}
    );
    expect(a.$ref).not.toBe(b.$ref);
    expect(await text.materialize((await repo.getOutputStreamByRef(a))!, "text")).toBe("x");
    const blob = await repo.getOutputByRef(b);
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([1]);
  });
});
