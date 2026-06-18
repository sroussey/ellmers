/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from "node:fs";

const CHROME_BINARY_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "chrome",
] as const;

const CHROME_ENV_VARS = ["CHROME_BIN", "GOOGLE_CHROME_BIN", "CHROMIUM_BIN"] as const;

const CHROME_PATHS_BY_PLATFORM = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
} as const satisfies Partial<Record<NodeJS.Platform, readonly string[]>>;

type ChromeLookup = (command: string) => string | null | undefined;

interface ChromeAvailabilityDeps {
  readonly which: ChromeLookup | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly fileExists: (filePath: string) => boolean;
}

function defaultWhich(command: string): string | null | undefined {
  const bun = (globalThis as any).Bun as { which?: ChromeLookup } | undefined;
  return bun?.which?.(command);
}

function hasChromeInPath(which: ChromeLookup | undefined): boolean {
  if (!which) {
    return false;
  }

  return CHROME_BINARY_NAMES.some((binaryName) => Boolean(which(binaryName)));
}

function hasChromeEnvPath(
  env: Readonly<Record<string, string | undefined>>,
  fileExists: (filePath: string) => boolean
): boolean {
  return CHROME_ENV_VARS.some((envVar) => {
    const filePath = env[envVar];
    return Boolean(filePath) && fileExists(filePath ?? "");
  });
}

function hasKnownChromeInstall(
  platform: NodeJS.Platform,
  fileExists: (filePath: string) => boolean
): boolean {
  const knownPaths =
    CHROME_PATHS_BY_PLATFORM[platform as keyof typeof CHROME_PATHS_BY_PLATFORM] ?? [];
  return knownPaths.some((filePath: string) => fileExists(filePath ?? ""));
}

export function isChromeAvailable(
  deps: ChromeAvailabilityDeps = {
    which: defaultWhich,
    env: process.env,
    platform: process.platform,
    fileExists: existsSync,
  }
): boolean {
  return (
    hasChromeInPath(deps.which) ||
    hasChromeEnvPath(deps.env, deps.fileExists) ||
    hasKnownChromeInstall(deps.platform, deps.fileExists)
  );
}
