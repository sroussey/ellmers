/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { stdin, stdout } from "node:process";

export type CliTheme =
  | { readonly level: "basic" }
  | {
      readonly level: "advanced";
      readonly fg: string;
      readonly bg: string;
      readonly medium: string;
      /**
       * One step further from the page than {@link CliTheme.medium}, for the
       * few marks that outrank their neighbours — the run's own progress bar
       * against the per-task ones. Close enough to still read as the same
       * family of chrome; the difference is meant to be noticed, not announced.
       */
      readonly strong: string;
    };

export const DEFAULT_CLI_THEME: CliTheme = { level: "basic" };

let cachedCliTheme: CliTheme = DEFAULT_CLI_THEME;

export function setCliTheme(theme: CliTheme): void {
  cachedCliTheme = theme;
}

export function getCliTheme(): CliTheme {
  return cachedCliTheme;
}

export interface TerminalRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function rgbToHex(c: TerminalRgb): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function mixRgb(a: TerminalRgb, b: TerminalRgb, t: number): TerminalRgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/** Parse xterm / iTerm2 style `rgb:…` (hex components; allows spaces). */
function extractRgbFromString(s: string): TerminalRgb | undefined {
  const m = s.match(/rgb\s*:\s*([0-9a-fA-F]+)\s*\/\s*([0-9a-fA-F]+)\s*\/\s*([0-9a-fA-F]+)/);
  if (m) {
    const r = normalizeHexComponent(m[1]);
    const g = normalizeHexComponent(m[2]);
    const b = normalizeHexComponent(m[3]);
    return { r, g, b };
  }
  const hex = s.match(/#([0-9a-f]{6})\b/i);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
    };
  }
  return undefined;
}

function normalizeHexComponent(hex: string): number {
  const v = parseInt(hex, 16);
  if (Number.isNaN(v)) return 0;
  if (v > 255) return Math.round((v / 65535) * 255);
  return v;
}

function responseComplete(buf: Buffer): boolean {
  const s = buf.toString("utf8");
  // eslint-disable-next-line no-control-regex
  return s.includes("\x07") || /\x1b\\/.test(s);
}

/** Readable `data` events may emit strings when an encoding is set (or in some runtimes). */
function dataChunkToBuffer(chunk: string | Buffer): Buffer {
  return typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
}

function readOscReply(timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      cleanup();
      resolve(Buffer.concat(chunks));
    }, timeoutMs);

    const onData = (data: string | Buffer): void => {
      chunks.push(dataChunkToBuffer(data));
      if (responseComplete(Buffer.concat(chunks))) {
        cleanup();
        resolve(Buffer.concat(chunks));
      }
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      stdin.removeListener("data", onData);
    };

    stdin.on("data", onData);
    stdin.resume();
  });
}

async function queryOsc4(index: -1 | -2): Promise<TerminalRgb | undefined> {
  const seq = index === -1 ? "\x1b]4;-1;?\x07" : "\x1b]4;-2;?\x07";
  const replyPromise = readOscReply(200);
  stdout.write(seq);
  const buf = await replyPromise;
  return extractRgbFromString(buf.toString("utf8"));
}

async function queryOsc10(): Promise<TerminalRgb | undefined> {
  const replyPromise = readOscReply(200);
  stdout.write("\x1b]10;?\x07");
  const buf = await replyPromise;
  return extractRgbFromString(buf.toString("utf8"));
}

async function queryOsc11(): Promise<TerminalRgb | undefined> {
  const replyPromise = readOscReply(200);
  stdout.write("\x1b]11;?\x07");
  const buf = await replyPromise;
  return extractRgbFromString(buf.toString("utf8"));
}

/**
 * When both stdin and stdout are TTYs, queries the emulator for default fg/bg via OSC 4 (-1/-2),
 * falling back to OSC 10/11. Returns a theme with semantic palette only when detection succeeds.
 */
export async function detectCliTheme(): Promise<CliTheme> {
  if (!stdout.isTTY || !stdin.isTTY) {
    return DEFAULT_CLI_THEME;
  }

  const stdinReadableFlowingBefore =
    "readableFlowing" in stdin
      ? (stdin as NodeJS.ReadStream & { readableFlowing?: boolean | null }).readableFlowing
      : null;
  let fg: TerminalRgb | undefined;
  let bg: TerminalRgb | undefined;

  try {
    stdin.setRawMode(true);

    fg = await queryOsc4(-1);
    bg = await queryOsc4(-2);

    if (!fg) fg = await queryOsc10();
    if (!bg) bg = await queryOsc11();
  } catch {
    return DEFAULT_CLI_THEME;
  } finally {
    try {
      if (stdin.isTTY) stdin.setRawMode(false);
      if (stdinReadableFlowingBefore !== true) stdin.pause();
    } catch {
      /* ignore */
    }
  }

  if (!fg || !bg) {
    return DEFAULT_CLI_THEME;
  }

  return cliPaletteFromRgb(fg, bg);
}

/**
 * The palette every mark in the UI is drawn from, mixed out of the terminal's
 * own two colors so chrome sits on the page rather than on top of it.
 *
 * Both greys are stated as a distance from the background, which is what makes
 * them work in either direction: on a dark terminal they come out brighter than
 * the page, on a light one darker, without either being special-cased.
 */
export function cliPaletteFromRgb(fg: TerminalRgb, bg: TerminalRgb): CliTheme {
  return {
    level: "advanced",
    fg: rgbToHex(fg),
    bg: rgbToHex(bg),
    /** A quarter of the way to the foreground: chrome that stays out of the way. */
    medium: rgbToHex(mixRgb(fg, bg, 0.75)),
    /** Halfway: for the few marks that outrank their neighbours. */
    strong: rgbToHex(mixRgb(fg, bg, 0.5)),
  };
}
