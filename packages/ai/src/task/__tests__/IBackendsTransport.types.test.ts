/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// ────────────────────────────────────────────────────────────────────────────
// Compile-time conformance tests for IBackendsTransport.
//
// These tests run via the test runner but their value is in `tsc` accepting
// (or rejecting) the declarations below. No runtime assertions of substance:
// if the file compiles, the contract holds.
//
// Lives under packages/test/src/test/ai/ so that scripts/test.ts picks it up
// (the runner only scans packages/test/src/test).
// ────────────────────────────────────────────────────────────────────────────

import type {
  IBackendStatus,
  IBackendsTransport,
  IEnsureRunningRequest,
  IRunningHandle,
} from "@workglow/ai/provider-utils";
import { expect, test } from "vitest";

// `opts` is open — accepts the historic llamacpp shape …
const _checkOptsWithCtx: IEnsureRunningRequest["opts"] = { ctx: 4096 };
// … the empty shape that sd-cpp uses today (no per-run options) …
const _checkOptsEmpty: IEnsureRunningRequest["opts"] = {};
// … and arbitrary shapes future backends may define.
const _checkOptsArbitrary: IEnsureRunningRequest["opts"] = { foo: "bar", n: 42 };

// Interface exposes `list` and `uninstall` alongside the existing methods.
type _Methods = keyof IBackendsTransport;
const _hasList: _Methods = "list";
const _hasUninstall: _Methods = "uninstall";

// Structural conformance using explicit parameter signatures: TypeScript
// allows assigning `() => X` to `(arg: T) => X`, so a zero-arg dummy would
// silently accept a parameter-list change. Spelling each signature out
// forces a typecheck failure on any rename, type change, or return-type
// change to a method of `IBackendsTransport`.
const _conforms: IBackendsTransport = {
  ensureRunning: (_req: IEnsureRunningRequest): Promise<IRunningHandle> => {
    return Promise.resolve({
      url: "http://127.0.0.1:0",
      release: (): Promise<void> => Promise.resolve(),
    });
  },
  subscribeStatus: (
    _backend: string,
    _callback: (status: IBackendStatus) => void
  ): (() => void) => {
    return (): void => undefined;
  },
  install: (
    _backend: string,
    _onProgress?: (bytes: number, total: number) => void
  ): Promise<void> => Promise.resolve(),
  list: (): Promise<void> => Promise.resolve(),
  uninstall: (_backend: string): Promise<void> => Promise.resolve(),
};

// Silence `no-unused-vars` / `noUnusedLocals` on the type-only assertions.
void _checkOptsWithCtx;
void _checkOptsEmpty;
void _checkOptsArbitrary;
void _hasList;
void _hasUninstall;
void _conforms;

// Vitest requires at least one runtime test in the file.
test("IBackendsTransport conformance compiles", () => {
  expect(true).toBe(true);
});
