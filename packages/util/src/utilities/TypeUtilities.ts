/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export type ConvertSomeToOptionalArray<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? Array<T[P]> | T[P] : T[P];
};

export type ConvertAllToOptionalArray<T> = {
  [P in keyof T]: Array<T[P]> | T[P];
};

export type ConvertSomeToArray<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? Array<T[P]> : T[P];
};

export type ConvertAllToArrays<T> = {
  [P in keyof T]: Array<T[P]>;
};

export type Writeable<T> = { -readonly [P in keyof T]: T[P] };

export type ObjectToArray<T extends Record<string, any>> = {
  [K in keyof T]: T[K][];
};

export type ArrayToObject<T extends Record<string, any>> = {
  [K in keyof T]: T[K] extends Array<infer U> ? U : T[K];
};
