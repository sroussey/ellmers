/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderJsonKvStorage, LazyEncryptedCredentialStore } from "@workglow/storage";
import { OtpPassphraseCache } from "@workglow/util";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const KEYRING_SERVICE = "workglow";
const KEYRING_ACCOUNT = "credential-passphrase";

const workglowDir = path.join(homedir(), ".workglow");
const credentialsDir = path.join(workglowDir, "credentials");
const credentialKeyPath = path.join(workglowDir, ".credential-key");

/**
 * Lazy credential store backed by encrypted file-based KV storage.
 * Starts locked; call {@link ensureCredentialStoreUnlocked} before
 * accessing encrypted credentials.
 */
export const lazyStore = new LazyEncryptedCredentialStore(
  new FsFolderJsonKvStorage(credentialsDir)
);

/**
 * In-memory OTP-masked passphrase cache with 6-hour hard TTL.
 * When the cache expires the lazy store is automatically locked.
 */
export const passphraseCache = new OtpPassphraseCache({
  hardTtlMs: 6 * 60 * 60 * 1000,
  onExpiry: () => lazyStore.lock(),
});

function isFsCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === code
  );
}

function formatKeyringError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One warning per process: OS keychain was not used (no permission dialog / no secure storage). */
let keyringFallbackWarned = false;

/**
 * Explains why the user may not see a macOS Keychain (or Linux Secret Service) prompt.
 * Set `WORKGLOW_SILENT_KEYRING=1` to suppress.
 */
function warnKeyringFallback(summary: string): void {
  if (keyringFallbackWarned || process.env.WORKGLOW_SILENT_KEYRING === "1") {
    return;
  }
  keyringFallbackWarned = true;
  const platformHint =
    process.platform === "darwin"
      ? " On macOS, use a normal GUI login session and allow your terminal app to access the keychain when prompted."
      : process.platform === "linux"
        ? " On Linux, a desktop session with Secret Service (e.g. gnome-keyring / kwallet) over D-Bus is usually required; SSH and many containers have no keychain."
        : "";
  console.warn(
    `[workglow] ${summary} Storing the encryption passphrase in ${credentialKeyPath} (file mode 0600) instead.${platformHint}`
  );
}

/**
 * Resolves the credential passphrase from (in priority order):
 * 1. `WORKGLOW_CREDENTIAL_PASSPHRASE` environment variable
 * 2. OS keyring via `@napi-rs/keyring`
 * 3. Legacy `~/.workglow/.credential-key` file (migrates to keyring, then deletes file)
 * 4. Generates a new random passphrase and stores it in the keyring
 */
export async function resolvePassphraseFromKeyring(): Promise<string> {
  // 1. Environment variable override
  if (process.env.WORKGLOW_CREDENTIAL_PASSPHRASE) {
    return process.env.WORKGLOW_CREDENTIAL_PASSPHRASE;
  }

  // Attempt to load the native keyring module; fall through to file-based
  // storage if the module is unavailable on this platform/runtime.
  let entry: { getPassword(): string | null; setPassword(pw: string): void } | undefined;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
  } catch (err) {
    warnKeyringFallback(`OS keyring module failed to load (${formatKeyringError(err)}).`);
  }

  // 2. Try OS keyring
  if (entry) {
    try {
      const existing = entry.getPassword();
      if (existing) return existing;
    } catch (err) {
      warnKeyringFallback(`Cannot read OS keychain (${formatKeyringError(err)}).`);
    }
  }

  // 3. Migrate from legacy file-based storage
  try {
    const fileKey = (await readFile(credentialKeyPath, "utf-8")).trim();
    if (fileKey) {
      if (entry) {
        try {
          entry.setPassword(fileKey);
          // Migration successful — remove the old file
          await unlink(credentialKeyPath);
        } catch (err) {
          warnKeyringFallback(
            `Could not migrate passphrase into OS keychain (${formatKeyringError(err)}).`
          );
        }
      }
      return fileKey;
    }
  } catch (err) {
    if (!isFsCode(err, "ENOENT")) throw err;
    // File doesn't exist — fall through to generate
  }

  // 4. Generate new passphrase
  const key = randomBytes(32).toString("hex");
  if (entry) {
    try {
      entry.setPassword(key);
      // Read back to handle any concurrent writes — use the persisted value
      try {
        const stored = entry.getPassword();
        if (stored) return stored;
      } catch (err) {
        warnKeyringFallback(
          `Could not read back passphrase from OS keychain (${formatKeyringError(err)}).`
        );
      }
      return key;
    } catch (err) {
      warnKeyringFallback(
        `Could not write passphrase to OS keychain (${formatKeyringError(err)}).`
      );
    }
  }

  // Fall back to file storage when keyring is unavailable or write failed
  await mkdir(path.dirname(credentialKeyPath), { recursive: true });
  try {
    await writeFile(credentialKeyPath, key, { mode: 0o600, flag: "wx" });
  } catch (writeErr) {
    if (isFsCode(writeErr, "EEXIST")) {
      return (await readFile(credentialKeyPath, "utf-8")).trim();
    }
    throw writeErr;
  }
  return key;
}

/**
 * Ensures the lazy credential store is unlocked and ready for use.
 * Retrieves the passphrase from the OTP cache if still valid, otherwise
 * resolves it from the keyring (or generates a new one).
 */
export async function ensureCredentialStoreUnlocked(): Promise<void> {
  if (lazyStore.isUnlocked) return;

  // Try OTP cache first
  const cached = passphraseCache.retrieve();
  if (cached) {
    await lazyStore.unlock(cached);
    return;
  }

  // Resolve from keyring / file / generate
  const passphrase = await resolvePassphraseFromKeyring();
  passphraseCache.store(passphrase);
  await lazyStore.unlock(passphrase);
}
