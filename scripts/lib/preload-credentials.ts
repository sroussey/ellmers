/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test preload that decrypts the on-disk credential store (if a passphrase is
 * available) and hydrates `process.env` for the providers that read API keys
 * from the environment. Designed to be referenced by both `vitest.setup.ts`
 * and `bunfig.toml`'s `[test].preload` list.
 *
 * Without a passphrase this is a no-op and integration tests skip through
 * their existing `!!process.env.*_API_KEY` guards.
 */

import { installAndHydrate, PASSPHRASE_ENV } from "./test-credentials";

const passphrase = process.env[PASSPHRASE_ENV];
const { unlocked, hydrated } = await installAndHydrate(passphrase);

if (unlocked && hydrated.length > 0) {
  // eslint-disable-next-line no-console
  console.log(
    `[test-preload] Unlocked encrypted credentials, hydrated env: ${hydrated.join(", ")}`
  );
}
