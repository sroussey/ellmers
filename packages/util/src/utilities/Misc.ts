/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export function forceArray<T = unknown>(input: T | T[]): T[] {
  if (Array.isArray(input)) return input;
  return [input];
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface IndexedArrayBufferView extends ArrayBufferView<ArrayBufferLike> {
  readonly length: number;
  readonly [index: number]: unknown;
}

/**
 * Takes an array of objects and collects values for each property into arrays
 * @param input Array of objects to process
 * @returns Object with arrays of values for each property
 */
export function collectPropertyValues<Input>(input: Input[]): { [K in keyof Input]: Input[K][] } {
  const output = {} as { [K in keyof Input]: Input[K][] };

  (input || []).forEach((item) => {
    Object.keys(item as object).forEach((key) => {
      const value = item[key as keyof Input];
      if (output[key as keyof Input]) {
        output[key as keyof Input].push(value);
      } else {
        output[key as keyof Input] = [value];
      }
    });
  });

  return output;
}

export function toSQLiteTimestamp(date: Date | null | undefined) {
  if (!date) return null;
  const pad = (number: number) => (number < 10 ? "0" + number : number);

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1); // getUTCMonth() returns months from 0-11
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (a && b && typeof a == "object" && typeof b == "object") {
    if (a.constructor !== b.constructor) return false;

    var length, i, keys;
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return false;
      length = a.length;
      if (length != b.length) return false;
      for (i = length; i-- !== 0;) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }

    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false;
      for (i of a.entries()) if (!b.has(i[0])) return false;
      for (i of a.entries()) if (!deepEqual(i[1], b.get(i[0]))) return false;
      return true;
    }

    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false;
      for (i of a.entries()) if (!b.has(i[0])) return false;
      return true;
    }

    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      if (a instanceof DataView || b instanceof DataView) {
        const viewA = a as DataView;
        const viewB = b as DataView;

        length = viewA.byteLength;
        if (length != viewB.byteLength) return false;
        for (i = length; i-- !== 0;) if (viewA.getUint8(i) !== viewB.getUint8(i)) return false;
        return true;
      }

      const viewA = a as IndexedArrayBufferView;
      const viewB = b as IndexedArrayBufferView;

      length = viewA.length;
      if (length != viewB.length) return false;
      for (i = length; i-- !== 0;) if (viewA[i] !== viewB[i]) return false;
      return true;
    }

    if (a instanceof RegExp && b instanceof RegExp) {
      return a.source === b.source && a.flags === b.flags;
    }
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();

    keys = Object.keys(a);
    length = keys.length;
    if (length !== Object.keys(b).length) return false;

    for (i = length; i-- !== 0;)
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;

    const objectA = a as Record<string, unknown>;
    const objectB = b as Record<string, unknown>;

    for (i = length; i-- !== 0;) {
      var key = keys[i];
      if (!deepEqual(objectA[key], objectB[key])) return false;
    }

    return true;
  }

  // true if both NaN, false otherwise
  return a !== a && b !== b;
}

export function sortObject(obj: Record<string, any>): Record<string, any> {
  return Object.keys(obj)
    .sort()
    .reduce(
      (result, key) => {
        result[key] = obj[key];
        return result;
      },
      {} as Record<string, any>
    );
}

export function serialize(obj: Record<string, any>): string {
  const sortedObj = sortObject(obj);
  return JSON.stringify(sortedObj);
}
