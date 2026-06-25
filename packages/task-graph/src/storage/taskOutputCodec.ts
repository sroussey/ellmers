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
 * Decodes the `value` a backing store round-tripped back into a task output. A
 * backend may hand the blob back as a Uint8Array, a number[], or a
 * numeric-keyed object, so all three shapes are normalized here.
 */
export async function decodeTaskOutput(
  rawValue: unknown,
  outputCompression: boolean
): Promise<TaskOutput> {
  if (outputCompression) {
    const bytes: Uint8Array =
      rawValue instanceof Uint8Array
        ? rawValue
        : Array.isArray(rawValue)
          ? new Uint8Array(rawValue as number[])
          : rawValue && typeof rawValue === "object"
            ? new Uint8Array(
                Object.keys(rawValue as Record<string, number>)
                  .filter((k) => /^\d+$/.test(k))
                  .sort((a, b) => Number(a) - Number(b))
                  .map((k) => (rawValue as Record<string, number>)[k])
              )
            : new Uint8Array();
    const decompressed = await decompress(bytes);
    return JSON.parse(decompressed) as TaskOutput;
  }
  const stringValue = (rawValue as { toString(): string }).toString();
  return JSON.parse(stringValue) as TaskOutput;
}
