/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun resolves `node:sqlite` with the same semantics as Node — BigInt reads,
 * rejected `undefined` bindings, `ERR_SQLITE_ERROR` + `errcode`, no
 * `transaction()` helper — so both runtimes share one driver rather than
 * maintaining a second adapter over `bun:sqlite`. `NodeSqliteDatabase` is named
 * for the `node:sqlite` module it wraps, not for the runtime it runs on.
 *
 * Requires Bun 1.4 or newer; earlier releases have no `node:sqlite` builtin.
 */

// organize-imports-ignore

export * from "./node";
