/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ColorObject {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_RGB_PATTERN =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i;

/**
 * Parse a `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA` hex color into a {@link ColorObject}.
 * Case-insensitive on input. No whitespace tolerance. Shorthand nibbles are doubled.
 * Throws on any malformed input.
 */
export function parseHexColor(hex: string): ColorObject {
  if (typeof hex !== "string" || !HEX_PATTERN.test(hex)) {
    throw new Error(`Invalid hex color: ${String(hex)}`);
  }
  const body = hex.slice(1);
  const double = (nibble: string): number => parseInt(nibble + nibble, 16);
  if (body.length === 3) {
    return { r: double(body[0]!), g: double(body[1]!), b: double(body[2]!), a: 255 };
  }
  if (body.length === 4) {
    return {
      r: double(body[0]!),
      g: double(body[1]!),
      b: double(body[2]!),
      a: double(body[3]!),
    };
  }
  if (body.length === 6) {
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
      a: 255,
    };
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
    a: parseInt(body.slice(6, 8), 16),
  };
}

const CHANNEL_MIN = 0;
const CHANNEL_MAX = 255;

function assertChannel(name: string, value: number): void {
  if (!Number.isInteger(value) || value < CHANNEL_MIN || value > CHANNEL_MAX) {
    throw new Error(`Color channel ${name} out of range (0-255 integer): ${value}`);
  }
}

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * Emit a {@link ColorObject} as `#RRGGBB` when `a === 255`, otherwise `#RRGGBBAA`.
 * Always lowercase, never shorthand. Throws on non-integer or out-of-range channels.
 */
export function toHexColor(c: ColorObject): string {
  assertChannel("r", c.r);
  assertChannel("g", c.g);
  assertChannel("b", c.b);
  assertChannel("a", c.a);
  const head = `#${byteToHex(c.r)}${byteToHex(c.g)}${byteToHex(c.b)}`;
  return c.a === 255 ? head : `${head}${byteToHex(c.a)}`;
}

function isInRangeByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

/**
 * Type guard for a {@link ColorObject}-shaped value (alpha optional).
 * Does not reject extra properties — JSON Schema validation handles that separately.
 */
export function isColorObject(value: unknown): value is ColorObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isInRangeByte(candidate.r)) return false;
  if (!isInRangeByte(candidate.g)) return false;
  if (!isInRangeByte(candidate.b)) return false;
  if (candidate.a !== undefined && !isInRangeByte(candidate.a)) return false;
  return true;
}

/** Type guard for a hex color string (same regex as `parseHexColor`). */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_PATTERN.test(value);
}

function parseCssRgbColor(value: string): ColorObject {
  const match = CSS_RGB_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid CSS rgb color: ${String(value)}`);
  }

  const r = Number.parseInt(match[1] ?? "", 10);
  const g = Number.parseInt(match[2] ?? "", 10);
  const b = Number.parseInt(match[3] ?? "", 10);
  const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
  assertChannel("r", r);
  assertChannel("g", g);
  assertChannel("b", b);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`Color alpha out of range (0-1 number): ${match[4]}`);
  }
  return { r, g, b, a: Math.round(alpha * 255) };
}

/**
 * Normalize any accepted wire form to a full {@link ColorObject}. Object inputs
 * default `a` to 255; CSS `rgb(...)` / `rgba(...)` strings use 0-1 alpha.
 * Throws on anything that's not an accepted color value.
 */
export function resolveColor(
  value: string | { r: number; g: number; b: number; a?: number }
): ColorObject {
  if (typeof value === "string") {
    if (isHexColor(value)) return parseHexColor(value);
    return parseCssRgbColor(value);
  }
  if (!isColorObject(value)) {
    throw new Error(`Invalid color value: ${JSON.stringify(value)}`);
  }
  return {
    r: value.r,
    g: value.g,
    b: value.b,
    a: value.a ?? 255,
  };
}
