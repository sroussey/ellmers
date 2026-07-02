/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  makeCacheRef,
  makeJobOutputStreamResolver,
  resolveJobOutputStream,
} from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { StreamingMemoryRepo } from "../../binding/StreamingMemoryRepo";

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

const handleFor = <T>(output: T) => ({ waitFor: () => Promise.resolve(output) });

describe("resolveJobOutputStream", () => {
  it("streams the ref at an explicit port", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStream("T", { a: 1 }, gen(new Uint8Array([1, 2, 3])), {});
    const handle = handleFor({ transcript: "hi", audio: ref });
    const stream = await resolveJobOutputStream(handle, repo, "audio");
    expect(stream).toBeDefined();
    expect(await collect(stream!)).toEqual([1, 2, 3]);
  });

  it("auto-discovers a single nested ref without a port", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStream("T", { a: 2 }, gen(new Uint8Array([9, 8])), {});
    const handle = handleFor({ meta: { inner: [ref] }, note: "x" });
    const stream = await resolveJobOutputStream(handle, repo);
    expect(await collect(stream!)).toEqual([9, 8]);
  });

  it("resolves undefined when the output has no refs and no port given", async () => {
    const repo = new StreamingMemoryRepo({});
    expect(await resolveJobOutputStream(handleFor({ text: "plain" }), repo)).toBeUndefined();
  });

  it("throws for two refs without an explicit port", async () => {
    const repo = new StreamingMemoryRepo({});
    const r1 = await repo.saveOutputStream("T", { a: 3 }, gen(new Uint8Array([1])), {});
    const r2 = await repo.saveOutputStream("T", { a: 4 }, gen(new Uint8Array([2])), {});
    await expect(resolveJobOutputStream(handleFor({ x: r1, y: r2 }), repo)).rejects.toThrow(
      /explicit port/
    );
  });

  it("adapts inline Blob / ArrayBuffer / Uint8Array values at a named port", async () => {
    const repo = new StreamingMemoryRepo({});
    const blobStream = await resolveJobOutputStream(
      handleFor({ data: new Blob([new Uint8Array([1, 2])]) }),
      repo,
      "data"
    );
    expect(await collect(blobStream!)).toEqual([1, 2]);

    const abStream = await resolveJobOutputStream(
      handleFor({ data: new Uint8Array([3, 4]).buffer }),
      repo,
      "data"
    );
    expect(await collect(abStream!)).toEqual([3, 4]);

    const u8Stream = await resolveJobOutputStream(
      handleFor({ data: new Uint8Array([5]) }),
      repo,
      "data"
    );
    expect(await collect(u8Stream!)).toEqual([5]);
  });

  it("resolves undefined for a dangling ref", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = makeCacheRef({ $ref: "inmem://gone" });
    expect(await resolveJobOutputStream(handleFor({ data: ref }), repo, "data")).toBeUndefined();
  });

  it("makeJobOutputStreamResolver closes over the backing", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStream("T", { a: 5 }, gen(new Uint8Array([7, 7])), {});
    const resolver = makeJobOutputStreamResolver(repo);
    const stream = await resolver({ file: ref }, "file");
    expect(await collect(stream!)).toEqual([7, 7]);
  });

  it("adapts an inline string at a named port to its UTF-8 bytes", async () => {
    // A below-threshold append-mode ref hydrates to an inline string; the
    // stream form must match what the surviving-ref form would have yielded,
    // so caller behavior does not flip on payload size.
    const repo = new StreamingMemoryRepo({});
    const stream = await resolveJobOutputStream(handleFor({ text: "hi" }), repo, "text");
    expect(await collect(stream!)).toEqual([104, 105]);
  });

  it("resolves undefined for an unsupported inline value", async () => {
    const repo = new StreamingMemoryRepo({});
    expect(await resolveJobOutputStream(handleFor({ n: 42 }), repo, "n")).toBeUndefined();
  });
});
