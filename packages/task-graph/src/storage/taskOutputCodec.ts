/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { compress, decompress } from "@workglow/util/compress";
import type { TaskOutput } from "../task/TaskTypes";

/**
 * Encodes a task output to the bytes stored in a cache row's `value` column.
 * The blob column is declared `string` in the schema, so callers store the
 * returned bytes through an `as unknown as string` cast (see TaskOutputRow.value).
 */
export async function encodeTaskOutput(
  output: TaskOutput,
  outputCompression: boolean
): Promise<Uint8Array> {
  const value = JSON.stringify(output);
  return outputCompression ? await compress(value) : Buffer.from(value);
}

/**
 * Normalizes the `value` a backing store round-tripped into bytes. A backend may
 * hand the blob back as a Uint8Array, a number[], or a numeric-keyed object
 * (structured-clone / JSON round-trips), so all three shapes are handled.
 */
function toBytes(rawValue: unknown): Uint8Array {
  if (rawValue instanceof Uint8Array) return rawValue;
  if (Array.isArray(rawValue)) return new Uint8Array(rawValue as number[]);
  if (rawValue && typeof rawValue === "object") {
    return new Uint8Array(
      Object.keys(rawValue as Record<string, number>)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => (rawValue as Record<string, number>)[k])
    );
  }
  return new Uint8Array();
}

/**
 * Decodes the `value` a backing store round-tripped back into a task output.
 * Mirrors {@link encodeTaskOutput}: gzip when compressed, otherwise UTF-8 JSON.
 */
export async function decodeTaskOutput(
  rawValue: unknown,
  outputCompression: boolean
): Promise<TaskOutput> {
  if (outputCompression) {
    const decompressed = await decompress(toBytes(rawValue));
    return JSON.parse(decompressed) as TaskOutput;
  }
  // Uncompressed: durable backends (SQL/IndexedDB) hand the blob back as bytes,
  // not a string, so decode the bytes as UTF-8 rather than calling `.toString()`
  // on a Uint8Array (which would yield comma-separated byte numbers).
  const json =
    typeof rawValue === "string" ? rawValue : new TextDecoder().decode(toBytes(rawValue));
  return JSON.parse(json) as TaskOutput;
}
