/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type declarations for {@link ./interpreter.js} (Neil Fraser JS interpreter).
 * Only members used by this package are typed; extend as needed.
 */
export declare class Interpreter {
  constructor(
    code: string | object,
    opt_initFunc?: (interpreter: Interpreter, globalScope: object) => void
  );
  run(): void;
  value: unknown;
}
