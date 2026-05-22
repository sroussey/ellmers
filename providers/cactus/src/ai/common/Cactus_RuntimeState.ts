/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Single source of truth for Cactus runtime state across bundle entry points.
//
// The package emits separate bundles for `./ai`, `./ai-runtime`,
// `./ai.browser`, and `./ai-runtime.browser`. Each bundle contains its own
// compiled copy of Cactus_Runtime.ts -> module-level Maps duplicate -> state
// desyncs. This module routes all access through a globalThis-keyed
// singleton (Symbol.for so duplicate symbol identities do not break it),
// so every bundle observes the same Maps.
//
// In a Web Worker context globalThis is per-worker, which is correct:
// engines do not transfer across workers anyway.

type AnyEngine = { free?: () => void };

export interface CactusRuntimeState {
  readonly version: 1;
  readonly engines: Map<string, AnyEngine>;
  readonly configJson: Map<string, unknown>;
  readonly cachedModelIds: Set<string>;
  readonly engineLoadsInFlight: Map<string, Promise<AnyEngine>>;
  readonly sessions: Map<string, Record<string, never>>;
}

const RUNTIME_KEY = Symbol.for("@workglow/cactus.runtime.v1");
type GlobalWithRuntime = { [RUNTIME_KEY]?: CactusRuntimeState };

export function getRuntime(): CactusRuntimeState {
  const g = globalThis as unknown as GlobalWithRuntime;
  let state = g[RUNTIME_KEY];
  if (!state) {
    state = {
      version: 1,
      engines: new Map(),
      configJson: new Map(),
      cachedModelIds: new Set(),
      engineLoadsInFlight: new Map(),
      sessions: new Map(),
    };
    g[RUNTIME_KEY] = state;
  } else if (state.version !== 1) {
    throw new Error(
      `Cactus runtime state version mismatch (found v${state.version}, expected v1). ` +
        `Mixed @workglow/cactus versions in the same process.`
    );
  }
  return state;
}

/** @internal Test-only — resets all maps by removing the singleton. */
export function __resetRuntimeForTests(): void {
  const g = globalThis as unknown as GlobalWithRuntime;
  delete g[RUNTIME_KEY];
}

// Convenience accessors used by Cactus_Runtime{,.browser}.ts
export function getCactusEngines() {
  return getRuntime().engines;
}
export function getCactusConfigJson() {
  return getRuntime().configJson;
}
export function getCactusCachedModelIds() {
  return getRuntime().cachedModelIds;
}
export function getCactusEngineLoadsInFlight() {
  return getRuntime().engineLoadsInFlight;
}
export function getCactusSessions() {
  return getRuntime().sessions;
}
