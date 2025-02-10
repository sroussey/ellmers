//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

export function forceArray<T = any>(input: T | T[]): T[] {
  if (Array.isArray(input)) return input;
  return [input];
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function deepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
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

export async function sha256(data: string): Promise<string> {
  if (typeof window === "object" && window.crypto && window.crypto.subtle) {
    // Browser environment
    const encoder = new TextEncoder();
    return window.crypto.subtle.digest("SHA-256", encoder.encode(data)).then((hashBuffer) => {
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    });
  } else if (typeof process === "object" && process.versions && process.versions.node) {
    // Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return Promise.resolve(new Bun.CryptoHasher("sha256").update(data).digest("hex"));
  } else {
    throw new Error("Unsupported environment");
  }
}

export async function makeFingerprint(input: any): Promise<string> {
  const serializedObj = serialize(input);
  const hash = await sha256(serializedObj);
  return hash;
}
