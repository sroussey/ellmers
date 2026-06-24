/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent, StreamMode } from "../task/StreamTypes";
import { foldObjectDelta } from "../task/StreamTypes";

/**
 * Translates a single output port's streaming deltas to and from the ordered
 * byte stream a streaming cache backing persists, and folds those bytes back
 * into the materialized port value. The persisted form is mode-specific:
 *
 *  - `append` — UTF-8 text blob (concatenated `text-delta`s).
 *  - `object` — NDJSON delta log: one JSON-encoded `object-delta` per line.
 *  - `binary` — identity bytes (concatenated `binary-delta`s).
 *
 * `encode` consumes a task's stream events and emits only the bytes for the
 * given port; `decode` reconstructs that port's delta events for cache-hit
 * replay; `materialize` folds the bytes into the value a non-streaming consumer
 * receives. `decode` + accumulation and `materialize` produce the same value.
 */
export interface StreamPortCodec {
  readonly mode: StreamMode;
  encode(events: AsyncIterable<StreamEvent>, port: string): AsyncIterable<Uint8Array>;
  decode(bytes: AsyncIterable<Uint8Array>, port: string): AsyncIterable<StreamEvent>;
  materialize(bytes: AsyncIterable<Uint8Array>, port: string): Promise<unknown>;
}

const appendCodec: StreamPortCodec = {
  mode: "append",
  async *encode(events, port) {
    const enc = new TextEncoder();
    for await (const e of events) {
      if (e.type === "text-delta" && e.port === port && e.textDelta) {
        yield enc.encode(e.textDelta);
      }
    }
  },
  async *decode(bytes, port) {
    const dec = new TextDecoder();
    for await (const chunk of bytes) {
      const text = dec.decode(chunk, { stream: true });
      if (text) yield { type: "text-delta", port, textDelta: text };
    }
    const tail = dec.decode();
    if (tail) yield { type: "text-delta", port, textDelta: tail };
  },
  async materialize(bytes) {
    const dec = new TextDecoder();
    let out = "";
    for await (const chunk of bytes) out += dec.decode(chunk, { stream: true });
    out += dec.decode();
    return out;
  },
};

const objectCodec: StreamPortCodec = {
  mode: "object",
  async *encode(events, port) {
    const enc = new TextEncoder();
    for await (const e of events) {
      if (e.type === "object-delta" && e.port === port) {
        yield enc.encode(JSON.stringify(e.objectDelta) + "\n");
      }
    }
  },
  decode: decodeObject,
  async materialize(bytes, port) {
    let acc: Record<string, unknown> | unknown[] | undefined;
    for await (const e of decodeObject(bytes, port)) {
      acc = foldObjectDelta(
        acc,
        (e as { objectDelta: Record<string, unknown> | unknown[] }).objectDelta
      );
    }
    return acc;
  },
};

async function* decodeObject(
  bytes: AsyncIterable<Uint8Array>,
  port: string
): AsyncIterable<StreamEvent> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of bytes) {
    buf += dec.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.length > 0) yield { type: "object-delta", port, objectDelta: JSON.parse(line) };
    }
  }
  buf += dec.decode();
  if (buf.trim().length > 0) yield { type: "object-delta", port, objectDelta: JSON.parse(buf) };
}

const binaryCodec: StreamPortCodec = {
  mode: "binary",
  async *encode(events, port) {
    for await (const e of events) {
      if (e.type === "binary-delta" && e.port === port) yield e.binaryDelta;
    }
  },
  async *decode(bytes, port) {
    for await (const chunk of bytes) yield { type: "binary-delta", port, binaryDelta: chunk };
  },
  async materialize(bytes) {
    const parts: Uint8Array[] = [];
    for await (const chunk of bytes) parts.push(chunk);
    return new Blob(parts as unknown as BlobPart[]);
  },
};

/**
 * Returns the codec for a streamable port mode. Only `append`, `object`, and
 * `binary` ports are persisted as delta streams; `replace` (snapshot-driven),
 * `none`, and `mixed` are rejected — those never produce a single-port delta
 * byte stream.
 */
export function getStreamPortCodec(mode: StreamMode): StreamPortCodec {
  switch (mode) {
    case "append":
      return appendCodec;
    case "object":
      return objectCodec;
    case "binary":
      return binaryCodec;
    default:
      throw new Error(
        `No stream codec for mode "${mode}": only append | object | binary persist as streams.`
      );
  }
}
