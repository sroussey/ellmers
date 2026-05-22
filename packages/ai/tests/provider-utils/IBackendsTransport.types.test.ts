/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// ────────────────────────────────────────────────────────────────────────────
// Compile-time conformance tests for IBackendsTransport.
//
// These tests run via the test runner but their value is in `tsc` accepting
// (or rejecting) the declarations below.  No runtime assertions: if the file
// compiles, the contract holds.
// ────────────────────────────────────────────────────────────────────────────

import type { IBackendsTransport, IEnsureRunningRequest } from "../../src/provider-utils";

// opts is now open — accepts the historic llamacpp shape …
const _checkOptsWithCtx: IEnsureRunningRequest["opts"] = { ctx: 4096 };
// … the empty shape for backends like sd-cpp that have no per-run opts …
const _checkOptsEmpty: IEnsureRunningRequest["opts"] = {};
// … and arbitrary shapes for future backends (MLX, whisper, etc.).
const _checkOptsArbitrary: IEnsureRunningRequest["opts"] = { foo: "bar", n: 42 };

// Interface exposes `list` and `uninstall` alongside the existing methods.
type _Methods = keyof IBackendsTransport;
const _hasList: _Methods = "list";
const _hasUninstall: _Methods = "uninstall";

// Structural-conformance dummy — any breaking change to the interface will
// fail typecheck on this assignment.
const _conforms: IBackendsTransport = {
  ensureRunning: async () => ({ url: "http://localhost", release: async () => {} }),
  subscribeStatus: () => () => {},
  install: async () => {},
  list: async () => {},
  uninstall: async () => {},
};

// Reference each binding so eslint's `no-unused-vars` and `noUnusedLocals`
// don't trip even though these assertions are purely compile-time.
void _checkOptsWithCtx;
void _checkOptsEmpty;
void _checkOptsArbitrary;
void _hasList;
void _hasUninstall;
void _conforms;

// Provide a single trivial runtime assertion so test runners that require at
// least one `test`/`it` block don't choke on this file.
import { describe, it, expect } from "vitest";
describe("IBackendsTransport (type-only conformance)", () => {
  it("compiles", () => {
    expect(true).toBe(true);
  });
});
