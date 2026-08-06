/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "./TaskError";

/**
 * Smart clone that deep-clones plain objects and arrays while preserving
 * class instances (objects with non-Object prototype) by reference.
 * Detects and throws an error on circular references.
 *
 * This is necessary because:
 * - structuredClone cannot clone class instances (methods are lost)
 * - JSON.parse/stringify loses methods and fails on circular references
 * - Class instances like repositories should be passed by reference
 *
 * @param obj The object to clone
 * @param visited Set of objects in the current cloning path (for circular reference detection)
 * @returns A cloned object with class instances preserved by reference
 */
export function smartClone(obj: any, visited: WeakSet<object> = new WeakSet()): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Primitives (string, number, boolean, symbol, bigint) are returned as-is
  if (typeof obj !== "object") {
    return obj;
  }

  // Check for circular references
  if (visited.has(obj)) {
    throw new TaskConfigurationError(
      "Circular reference detected in input data. " +
        "Cannot clone objects with circular references."
    );
  }

  // Clone TypedArrays (Float32Array, Int8Array, etc.) to avoid shared-mutation
  // between defaults and runInputData, while preserving DataView by reference.
  if (ArrayBuffer.isView(obj)) {
    // Preserve DataView instances by reference (constructor signature differs)
    if (typeof DataView !== "undefined" && obj instanceof DataView) {
      return obj;
    }
    // For TypedArrays, create a new instance with the same data
    const typedArray = obj as any;
    return new (typedArray.constructor as any)(typedArray);
  }

  // Preserve class instances (objects with non-Object/non-Array prototype)
  // This includes repository instances, custom classes, etc.
  if (!Array.isArray(obj)) {
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      return obj; // Pass by reference
    }
  }

  // Add object to visited set before recursing
  visited.add(obj);

  try {
    // Deep clone arrays, preserving class instances within
    if (Array.isArray(obj)) {
      return obj.map((item) => smartClone(item, visited));
    }

    // Deep clone plain objects
    const result: Record<string, any> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = smartClone(obj[key], visited);
      }
    }
    return result;
  } finally {
    // Remove from visited set after processing to allow the same object
    // in different branches (non-circular references)
    visited.delete(obj);
  }
}

/**
 * Strips symbol properties from an object to make it serializable.
 * TypedArrays and class instances are passed through by reference.
 *
 * @param obj The object to strip symbols from
 * @returns A new object without symbol properties
 */
export function stripSymbols(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  // Preserve TypedArrays (Float32Array, Int8Array, etc.)
  if (ArrayBuffer.isView(obj)) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => stripSymbols(item));
  }
  if (typeof obj === "object") {
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      return obj;
    }

    const result: Record<string, any> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = stripSymbols(obj[key]);
      }
    }
    return result;
  }
  return obj;
}
