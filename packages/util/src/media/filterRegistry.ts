/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GpuImage, GpuImageBackend } from "./gpuImage";

export type FilterOpFn<P = unknown> = (image: GpuImage, params: P) => GpuImage;

// Cross-bundle singleton — same pattern as previewBudget.ts. The registry
// must be process-wide because filter arms and applyFilter consumers can be
// loaded through different bundle entries that resolve @workglow/util/media
// to independent module instances. Storing the Map in a globalThis slot
// keyed by Symbol.for(...) gives them all a single shared registry.
const GLOBAL_REGISTRY_KEY = Symbol.for("@workglow/util/media/filterRegistry");
const _g = globalThis as Record<symbol, unknown>;

function getRegistry(): Map<string, FilterOpFn<unknown>> {
  let reg = _g[GLOBAL_REGISTRY_KEY] as Map<string, FilterOpFn<unknown>> | undefined;
  if (!reg) {
    reg = new Map();
    _g[GLOBAL_REGISTRY_KEY] = reg;
  }
  return reg;
}

const key = (backend: GpuImageBackend, filter: string): string => `${backend}:${filter}`;

export function registerFilterOp<P>(
  backend: GpuImageBackend,
  filter: string,
  fn: FilterOpFn<P>
): void {
  getRegistry().set(key(backend, filter), fn as FilterOpFn<unknown>);
}

export function applyFilter<P>(image: GpuImage, filter: string, params: P): GpuImage {
  const fn = getRegistry().get(key(image.backend, filter));
  if (!fn) {
    throw new Error(
      `applyFilter("${filter}") on backend "${image.backend}": no implementation registered. ` +
        `Task-layer fallback should have routed this to "cpu" first; this means even the cpu arm is missing. ` +
        `Ensure @workglow/tasks has been imported so its filter-arm side effects run.`
    );
  }
  return fn(image, params);
}

export function hasFilterOp(backend: GpuImageBackend, filter: string): boolean {
  return getRegistry().has(key(backend, filter));
}
