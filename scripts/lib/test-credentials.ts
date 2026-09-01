/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { LazyEncryptedCredentialStore } from "../../packages/storage/src/credentials/LazyEncryptedCredentialStore";
import { FsFolderJsonKvStorage } from "../../packages/storage/src/kv/FsFolderJsonKvStorage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

export const SECRETS_DIR = path.join(REPO_ROOT, ".secrets", "credentials");
export const PASSPHRASE_ENV = "WORKGLOW_SECRETS_PASSPHRASE";

export const CREDENTIAL_TO_ENV: Readonly<Record<string, string>> = {
  "anthropic-api-key": "ANTHROPIC_API_KEY",
  "openai-api-key": "OPENAI_API_KEY",
  "google-api-key": "GOOGLE_API_KEY",
  "gemini-api-key": "GEMINI_API_KEY",
  "hf-token": "HF_TOKEN",
  "xai-api-key": "XAI_API_KEY",
  "openrouter-api-key": "OPENROUTER_API_KEY",
  "deepseek-api-key": "DEEPSEEK_API_KEY",
};

export interface BuiltStore {
  readonly encrypted: LazyEncryptedCredentialStore;
  readonly unlocked: boolean;
}

/**
 * Build the on-disk encrypted credential store. If `passphrase` is omitted,
 * the store stays locked and all reads return `undefined`.
 *
 * `secretsDir` defaults to the canonical {@link SECRETS_DIR}; tests can pass
 * a temp directory to exercise the store in isolation.
 */
export async function buildCredentialStore(
  passphrase: string | undefined,
  secretsDir: string = SECRETS_DIR
): Promise<BuiltStore> {
  const kv = new FsFolderJsonKvStorage(secretsDir);
  const encrypted = new LazyEncryptedCredentialStore(kv);
  if (passphrase) {
    try {
      await encrypted.unlock(passphrase);
    } catch {
      // Match prior best-effort behaviour: a wrong passphrase leaves the
      // store locked and the caller logs a warning. (`installAndHydrate`
      // and CLI subcommands both already gate on `encrypted.isUnlocked`.)
    }
  }
  return { encrypted, unlocked: encrypted.isUnlocked };
}

/**
 * Hydrate `process.env` from the encrypted store for the duration of the
 * test process. Only keys not already present in `process.env` are written,
 * so an explicit shell export always wins.
 *
 * Decryption errors (wrong passphrase / stale ciphertext) leave `process.env`
 * untouched and produce one warning, so unit tests stay green and integration
 * tests skip via their existing `!!process.env.*_API_KEY` guards.
 *
 * The global credential store is intentionally NOT replaced — provider
 * clients use the env fallback, and overriding the registry default would
 * break unit tests that assert the default is `InMemoryCredentialStore`.
 *
 * `secretsDir` defaults to {@link SECRETS_DIR}; tests pass a temp directory.
 */
export async function installAndHydrate(
  passphrase: string | undefined,
  secretsDir: string = SECRETS_DIR
): Promise<{
  readonly unlocked: boolean;
  readonly hydrated: readonly string[];
}> {
  if (!passphrase) return { unlocked: false, hydrated: [] };

  const { encrypted } = await buildCredentialStore(passphrase, secretsDir);
  if (!encrypted.isUnlocked) return { unlocked: false, hydrated: [] };

  // Decrypt into a temporary map first; only if every existing ciphertext
  // decrypts cleanly do we write to `process.env`.
  const pending: Array<readonly [string, string]> = [];
  for (const [credKey, envVar] of Object.entries(CREDENTIAL_TO_ENV)) {
    if (process.env[envVar]) continue;
    let value: string | undefined;
    try {
      value = await encrypted.get(credKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[test-credentials] Failed to decrypt "${credKey}" — wrong passphrase or stale ciphertext. Fix the passphrase and run \`bun scripts/credentials.ts rotate\`, or re-import keys with \`import-env\`. Underlying error: ${msg}`
      );
      return { unlocked: false, hydrated: [] };
    }
    if (value) pending.push([envVar, value] as const);
  }

  const hydrated: string[] = [];
  for (const [envVar, value] of pending) {
    process.env[envVar] = value;
    hydrated.push(envVar);
  }
  return { unlocked: true, hydrated };
}
