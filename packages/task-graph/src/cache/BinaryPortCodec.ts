/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { base64ToBytes, bytesToBase64, registerPortCodec } from "@workglow/util";
import { isCacheRef } from "./CacheRef";

/**
 * JSON-safe wire form for inline binary port values. Without a codec,
 * `JSON.stringify(new Blob(...))` is `"{}"` — a cacheable task with a binary
 * output port and a non-streaming (JSON-row) cache backing would silently
 * persist an empty object and corrupt every later cache hit.
 *
 * Base64 inflates the payload ~1.33× (plus a UTF-16 spike inside
 * `JSON.stringify`), so this path is intended for small payloads; large
 * binary outputs belong on a streaming-capable backing where the row carries
 * a `CacheRef` envelope instead of bytes.
 */
export interface BinaryPortWire {
  readonly __binaryPortWire: 1;
  readonly base64: string;
  readonly size: number;
  readonly mime: string | undefined;
}

function isBinaryPortWire(value: unknown): value is BinaryPortWire {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return o.__binaryPortWire === 1 && typeof o.base64 === "string" && typeof o.size === "number";
}

/**
 * Values that are not raw bytes pass through unchanged in BOTH directions:
 * on the streaming-cache path the port slot holds a `CacheRef` envelope (the
 * row must keep it verbatim for cache-hit replay/hydration), and legacy rows
 * may hold shapes written before this codec existed. Only `Blob`,
 * `ArrayBuffer`, and `ArrayBuffer` views are encoded.
 */
async function serializeBinary(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    return {
      __binaryPortWire: 1,
      base64: bytesToBase64(bytes),
      size: bytes.byteLength,
      mime: value.type === "" ? undefined : value.type,
    } satisfies BinaryPortWire;
  }
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    return {
      __binaryPortWire: 1,
      base64: bytesToBase64(bytes),
      size: bytes.byteLength,
      mime: undefined,
    } satisfies BinaryPortWire;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    return {
      __binaryPortWire: 1,
      base64: bytesToBase64(bytes),
      size: bytes.byteLength,
      mime: undefined,
    } satisfies BinaryPortWire;
  }
  return value;
}

registerPortCodec<unknown, unknown>("blob", {
  async serialize(value) {
    return serializeBinary(value);
  },
  async deserialize(wire) {
    if (isCacheRef(wire) || !isBinaryPortWire(wire)) return wire;
    const bytes = base64ToBytes(wire.base64);
    return new Blob(
      [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
      wire.mime ? { type: wire.mime } : undefined
    );
  },
});

registerPortCodec<unknown, unknown>("binary", {
  async serialize(value) {
    return serializeBinary(value);
  },
  async deserialize(wire) {
    if (isCacheRef(wire) || !isBinaryPortWire(wire)) return wire;
    const bytes = base64ToBytes(wire.base64);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  },
});
