/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export type Cursor<T> = {
  length: number;
  next: () => IteratorResult<T>;
  [Symbol.iterator]: () => Iterator<T>;
};
/**
 * Creates a proxy that treats an object-of-arrays as an array-of-objects.
 * It lazily computes each row when accessed and lets you update or add new rows.
 *
 * When adding a new object (either via .push or assignment to the next index),
 * the underlying arrays are updated accordingly.
 *
 * @param data An object whose properties are arrays (assumed to have equal lengths)
 * @returns A proxy that behaves like an array of objects backed by the input arrays
 */
export function objectOfArraysAsArrayOfObjects<T extends Record<string, any>>(data: {
  [K in keyof T]: T[K][];
}): Array<T> & { cursor: () => Cursor<T> } {
  const keys = Object.keys(data) as (keyof T)[];
  const length = data[keys[0]].length;
  for (const key of keys) {
    if (data[key].length !== length) {
      console.error("All arrays must have the same length", key, data[key].length, length, data);
      throw new Error("All arrays must have the same length");
    }
  }

  const indexSymbol = Symbol("index");

  /**
   * Creates a live row proxy for the given index.
   * The proxy intercepts get/set operations so that reads and writes
   * go directly to data[key][index].
   */
  function createRowProxy(index: number): T & { [indexSymbol]: number } {
    let currentIndex = index;
    return new Proxy({} as T & { [indexSymbol]: number }, {
      get(_target, prop, receiver) {
        if (currentIndex < 0 || currentIndex >= data[keys[0]].length) {
          return undefined;
        }
        if (typeof prop === "string" && keys.includes(prop as keyof T)) {
          return data[prop as keyof T][currentIndex];
        }
        if (prop === indexSymbol) {
          return currentIndex;
        }
        return Reflect.get(_target, prop, receiver);
      },
      set(_target, prop, value, receiver) {
        if (currentIndex < 0 || currentIndex >= data[keys[0]].length) {
          return false;
        }
        if (typeof prop === "string" && keys.includes(prop as keyof T)) {
          data[prop as keyof T][currentIndex] = value;
          return true;
        }
        if (prop === indexSymbol) {
          currentIndex = value;
          return true;
        }
        return Reflect.set(_target, prop, value, receiver);
      },
      ownKeys(_target) {
        return keys as string[];
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === "string" && keys.includes(prop as keyof T)) {
          return { enumerable: true, configurable: true };
        }
        return undefined;
      },
    });
  }

  function createCursor(): Cursor<T> {
    let currentIndex = 0;

    const cursor = createRowProxy(0);

    const obj = {
      get length() {
        return data[keys[0]].length;
      },
      next(): IteratorResult<T> {
        if (currentIndex < length) {
          cursor[indexSymbol] = currentIndex;
          currentIndex++;
          return { done: false, value: cursor };
        } else {
          return { done: true, value: undefined as any };
        }
      },
      [Symbol.iterator](): Iterator<T> {
        currentIndex = 0;
        cursor[indexSymbol] = currentIndex;
        return obj;
      },
    };
    return obj as Cursor<T>;
  }

  function shallowEqual(index: number, row: T): boolean {
    for (const key of keys) {
      if (data[key][index] !== row[key]) return false;
    }
    return true;
  }

  return new Proxy([] as Array<T>, {
    get(target, prop, receiver) {
      if (prop === "length") {
        return data[keys[0]].length;
      }

      if (prop === "cursor") {
        return function () {
          return createCursor();
        };
      }

      if (prop === "reverse") {
        return function () {
          for (const key of keys) {
            data[key].reverse();
          }
          return receiver;
        };
      }

      if (prop === "push") {
        return function (...args: T[]) {
          for (const item of args) {
            for (const key of keys) {
              data[key].push(item[key]);
            }
          }
          return data[keys[0]].length;
        };
      }

      if (prop === "pop") {
        return function () {
          const len = data[keys[0]].length;
          if (len === 0) return undefined;
          const poppedRow = {} as T;
          for (const key of keys) {
            poppedRow[key] = data[key].pop() as T[keyof T];
          }
          return poppedRow;
        };
      }

      if (prop === "unshift") {
        return function (...args: T[]) {
          // Iterate from the last argument to the first to preserve order.
          for (let i = args.length - 1; i >= 0; i--) {
            const item = args[i];
            for (const key of keys) {
              data[key].unshift(item[key]);
            }
          }
          return data[keys[0]].length;
        };
      }

      if (prop === "shift") {
        return function () {
          if (data[keys[0]].length === 0) return undefined;
          const shiftedRow = {} as T;
          for (const key of keys) {
            shiftedRow[key] = data[key].shift() as T[keyof T];
          }
          return shiftedRow;
        };
      }

      if (prop === "splice") {
        return function (start: number, deleteCount?: number, ...items: T[]) {
          const len = data[keys[0]].length;
          if (start < 0) {
            start = len + start;
            if (start < 0) start = 0;
          }
          if (deleteCount === undefined) {
            deleteCount = len - start;
          }
          const removedByKey: { [K in keyof T]: T[K][] } = {} as any;
          for (const key of keys) {
            removedByKey[key] = data[key].splice(
              start,
              deleteCount,
              ...items.map((item) => item[key])
            );
          }
          const removed: T[] = [];
          for (let i = 0; i < deleteCount; i++) {
            const row = {} as T;
            for (const key of keys) {
              row[key] = removedByKey[key][i];
            }
            removed.push(row);
          }
          return removed;
        };
      }

      if (prop === "sort") {
        return function (compareFn?: (a: T, b: T) => number) {
          const rows = [...receiver];
          rows.sort(compareFn);
          for (const key of keys) {
            data[key] = rows.map((row) => row[key]);
          }
          return receiver;
        };
      }

      if (prop === "includes") {
        return function (searchElement: T, fromIndex?: number) {
          const len = data[keys[0]].length;
          let start = fromIndex ?? 0;
          if (start < 0) {
            start = Math.max(0, len + start);
          }
          for (let i = start; i < len; i++) {
            if (shallowEqual(i, searchElement)) return true;
          }
          return false;
        };
      }
      if (prop === "indexOf") {
        return function (searchElement: T, fromIndex?: number) {
          const len = data[keys[0]].length;
          let start = fromIndex ?? 0;
          if (start < 0) {
            start = Math.max(0, len + start);
          }
          for (let i = start; i < len; i++) {
            if (shallowEqual(i, searchElement)) return i;
          }
          return -1;
        };
      }
      if (prop === "lastIndexOf") {
        return function (searchElement: T, fromIndex?: number) {
          const len = data[keys[0]].length;
          let start = fromIndex ?? len - 1;
          if (start < 0) {
            start = len + start;
          }
          for (let i = start; i >= 0; i--) {
            if (shallowEqual(i, searchElement)) return i;
          }
          return -1;
        };
      }

      if (prop === "forEach") {
        return function (callback: (value: T, index: number, array: T[]) => void, thisArg?: any) {
          return [...receiver].forEach(callback, thisArg);
        };
      }
      if (prop === "map") {
        return function (callback: (value: T, index: number, array: T[]) => any, thisArg?: any) {
          return [...receiver].map(callback, thisArg);
        };
      }
      if (prop === "filter") {
        return function (
          callback: (value: T, index: number, array: T[]) => boolean,
          thisArg?: any
        ) {
          return [...receiver].filter(callback, thisArg);
        };
      }
      if (prop === "reduce") {
        return function (
          callback: (accumulator: any, currentValue: T, currentIndex: number, array: T[]) => any,
          initialValue?: any
        ) {
          return [...receiver].reduce(callback, initialValue);
        };
      }
      if (prop === "find") {
        return function (
          callback: (value: T, index: number, array: T[]) => boolean,
          thisArg?: any
        ) {
          return [...receiver].find(callback, thisArg);
        };
      }
      if (prop === "every") {
        return function (
          callback: (value: T, index: number, array: T[]) => boolean,
          thisArg?: any
        ) {
          return [...receiver].every(callback, thisArg);
        };
      }
      if (prop === "some") {
        return function (
          callback: (value: T, index: number, array: T[]) => boolean,
          thisArg?: any
        ) {
          return [...receiver].some(callback, thisArg);
        };
      }

      if (typeof prop === "string" && !isNaN(Number(prop))) {
        const index = Number(prop);
        if (index < 0 || index >= data[keys[0]].length) {
          return undefined;
        }
        return createRowProxy(index);
      }

      if (prop === Symbol.iterator) {
        return function* () {
          for (let i = 0; i < data[keys[0]].length; i++) {
            yield createRowProxy(i);
          }
        };
      }

      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (typeof prop === "string" && !isNaN(Number(prop))) {
        const index = Number(prop);
        if (index === data[keys[0]].length) {
          for (const key of keys) {
            data[key].push(value[key]);
          }
          return true;
        } else if (index < data[keys[0]].length) {
          for (const key of keys) {
            if (value.hasOwnProperty(key)) {
              data[key][index] = value[key];
            }
          }
          return true;
        }
      }
      return Reflect.set(target, prop, value, receiver);
    },
    deleteProperty(target, prop) {
      if (typeof prop === "string" && !isNaN(Number(prop))) {
        const index = Number(prop);
        if (index >= 0 && index < data[keys[0]].length) {
          for (const key of keys) {
            data[key].splice(index, 1);
          }
          return true;
        }
      }
      return Reflect.deleteProperty(target, prop);
    },
  }) as Array<T> & { cursor: () => Cursor<T> };
}
