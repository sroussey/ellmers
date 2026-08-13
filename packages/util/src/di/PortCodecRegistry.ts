/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

export interface PortCodec<Live = unknown, Wire = unknown> {
  serialize(value: Live): Promise<Wire>;
  deserialize(value: Wire): Promise<Live>;
}

/**
 * Codec registry shared across bundle copies via a Symbol.for key — same pattern
 * as globalContainer. Without this, split entry points (e.g. @workglow/util,
 * @workglow/util/media, @workglow/task-graph) could each see their own Map and
 * fail to find codecs registered by sibling entries.
 */
const GLOBAL_CODECS_KEY = Symbol.for("@workglow/util/di/portCodecs");
const _g = globalThis as Record<symbol, unknown>;
if (!_g[GLOBAL_CODECS_KEY]) {
  _g[GLOBAL_CODECS_KEY] = new Map<string, PortCodec>();
}
const codecs = _g[GLOBAL_CODECS_KEY] as Map<string, PortCodec>;

export function registerPortCodec<Live = unknown, Wire = unknown>(
  formatPrefix: string,
  codec: PortCodec<Live, Wire>
): void {
  codecs.set(formatPrefix, codec as PortCodec);
}

export function getPortCodec(format: string): PortCodec | undefined {
  if (codecs.has(format)) return codecs.get(format);
  const colon = format.indexOf(":");
  if (colon > 0) {
    const prefix = format.slice(0, colon);
    return codecs.get(prefix);
  }
  return undefined;
}
