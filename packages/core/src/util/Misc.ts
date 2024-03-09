//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { createHash } from "crypto";
import { TaskInput } from "../task/Task";

export function forceArray<T = any>(input: T | T[]): T[] {
  if (Array.isArray(input)) return input;
  return [input];
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) {
    return false;
  }

  let keysA = Object.keys(a);
  let keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (let key of keysA) {
    if (!keysB.includes(key)) {
      return false;
    }

    if (!deepEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
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

export function makeFingerprint(input: TaskInput): string {
  const serializedObj = serialize(input);
  return createHash("sha256").update(serializedObj).digest("hex");
}
