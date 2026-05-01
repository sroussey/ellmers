#!/usr/bin/env bun

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI for managing the encrypted credential store at .secrets/credentials/.
 *
 * Usage:
 *   bun scripts/credentials.ts set <key>            # interactive (TTY) or via stdin pipe
 *   bun scripts/credentials.ts get <key>
 *   bun scripts/credentials.ts list
 *   bun scripts/credentials.ts delete <key>
 *   bun scripts/credentials.ts import-env
 *   bun scripts/credentials.ts import-dot-env <file>
 *   bun scripts/credentials.ts rotate
 *
 * The passphrase is read from $WORKGLOW_SECRETS_PASSPHRASE; the new passphrase
 * for `rotate` is read from $WORKGLOW_NEW_SECRETS_PASSPHRASE. Encrypted
 * ciphertext is stored in .secrets/credentials/ as JSON files (one per key)
 * and is safe to commit. Only the passphrase is sensitive.
 *
 * Known credential keys (mapped to env vars at test setup):
 *   anthropic-api-key  → ANTHROPIC_API_KEY
 *   openai-api-key     → OPENAI_API_KEY
 *   google-api-key     → GOOGLE_API_KEY
 *   gemini-api-key     → GEMINI_API_KEY
 *   hf-token           → HF_TOKEN
 */

import { mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseDotEnv } from "./lib/parse-dot-env";
import {
  buildCredentialStore,
  CREDENTIAL_TO_ENV,
  PASSPHRASE_ENV,
  SECRETS_DIR,
} from "./lib/test-credentials";

const NEW_PASSPHRASE_ENV = "WORKGLOW_NEW_SECRETS_PASSPHRASE";

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function requirePassphrase(envVar: string = PASSPHRASE_ENV): string {
  const p = process.env[envVar];
  if (!p) {
    fail(
      `${envVar} is not set. Pick a strong passphrase, store it in your OS keychain or CI secret, then export it before running this command.`
    );
  }
  return p;
}

/**
 * Read a secret from stdin without echoing it back to the terminal. If stdin
 * is a TTY, raw mode is enabled and characters are absorbed silently until
 * Enter (Ctrl-C aborts). If stdin is piped (non-TTY), reads the first line
 * and returns it — useful for `printf '%s\n' "$secret" | credentials.ts set ...`
 * so callers can pipe from password managers without leaking via argv or echo.
 */
async function readSecretInteractive(prompt: string): Promise<string> {
  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  const isTty = process.stdin.isTTY === true;

  return new Promise<string>((resolveValue, rejectValue) => {
    let buf = "";
    let restored = false;

    const restore = (): void => {
      if (restored) return;
      restored = true;
      stdin.off("data", onData);
      stdin.pause();
      if (isTty) {
        try {
          stdin.setRawMode(false);
        } catch {
          // Ignore: terminal already torn down.
        }
      }
    };

    const finish = (value: string): void => {
      restore();
      if (isTty) process.stdout.write("\n");
      resolveValue(value);
    };

    const onData = (chunk: string): void => {
      if (!isTty) {
        // Piped input: read the first line, leave the rest for the caller.
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl >= 0) finish(buf.slice(0, nl).trimEnd());
        return;
      }
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === "\r" || ch === "\n") {
          finish(buf);
          return;
        }
        if (code === 3) {
          // Ctrl-C
          restore();
          process.stdout.write("\n");
          rejectValue(new Error("aborted"));
          return;
        }
        if (code === 127 || ch === "\b") {
          buf = buf.slice(0, -1);
          continue;
        }
        if (code < 32) continue;
        buf += ch;
      }
    };

    if (isTty) {
      process.stdout.write(prompt);
      try {
        stdin.setRawMode(true);
      } catch (err) {
        rejectValue(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function cmdSet(key: string): Promise<void> {
  const passphrase = requirePassphrase();
  mkdirSync(SECRETS_DIR, { recursive: true });
  const value = await readSecretInteractive(`Enter value for "${key}" (input hidden): `);
  if (!value) fail("empty value");
  const { encrypted } = buildCredentialStore(passphrase);
  await encrypted.put(key, value, { provider: providerForKey(key) });
  console.log(`stored "${key}"`);
}

async function cmdGet(key: string): Promise<void> {
  const passphrase = requirePassphrase();
  const { encrypted } = buildCredentialStore(passphrase);
  const value = await encrypted.get(key);
  if (value === undefined) fail(`no such key: ${key}`);
  process.stdout.write(value);
  if (process.stdout.isTTY) process.stdout.write("\n");
}

async function cmdList(): Promise<void> {
  const passphrase = requirePassphrase();
  const { encrypted } = buildCredentialStore(passphrase);
  const keys = await encrypted.keys();
  if (keys.length === 0) {
    console.log("(no credentials stored)");
    return;
  }
  for (const k of [...keys].sort()) {
    const env = CREDENTIAL_TO_ENV[k];
    console.log(env ? `${k}  →  ${env}` : k);
  }
}

async function cmdDelete(key: string): Promise<void> {
  const passphrase = requirePassphrase();
  const { encrypted } = buildCredentialStore(passphrase);
  const ok = await encrypted.delete(key);
  console.log(ok ? `deleted "${key}"` : `no such key: ${key}`);
}

async function cmdImportEnv(): Promise<void> {
  const passphrase = requirePassphrase();
  mkdirSync(SECRETS_DIR, { recursive: true });
  const { encrypted } = buildCredentialStore(passphrase);
  const imported: string[] = [];
  for (const [credKey, envVar] of Object.entries(CREDENTIAL_TO_ENV)) {
    const v = process.env[envVar];
    if (!v) continue;
    await encrypted.put(credKey, v, { provider: providerForKey(credKey) });
    imported.push(`${envVar} → ${credKey}`);
  }
  if (imported.length === 0) {
    console.log("(no known credential env vars set in this shell)");
    return;
  }
  console.log("imported:");
  for (const line of imported) console.log(`  ${line}`);
}

async function cmdImportDotEnv(file: string): Promise<void> {
  const passphrase = requirePassphrase();
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch (err) {
    fail(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: ReadonlyMap<string, string>;
  try {
    parsed = parseDotEnv(source);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  // Reverse map: env-var-name → credential-key. Preserves the canonical
  // key for env vars (e.g. GOOGLE_API_KEY → google-api-key) when a file
  // contains both `GOOGLE_API_KEY` and `GEMINI_API_KEY`.
  const envToCred = new Map(
    Object.entries(CREDENTIAL_TO_ENV).map(([cred, env]) => [env, cred] as const)
  );

  mkdirSync(SECRETS_DIR, { recursive: true });
  const { encrypted } = buildCredentialStore(passphrase);
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const [envVar, value] of parsed) {
    const credKey = envToCred.get(envVar);
    if (!credKey) {
      skipped.push(envVar);
      continue;
    }
    if (!value) continue;
    await encrypted.put(credKey, value, { provider: providerForKey(credKey) });
    imported.push(`${envVar} → ${credKey}`);
  }
  if (imported.length === 0) {
    console.log(`(no known credential env vars found in ${file})`);
  } else {
    console.log("imported:");
    for (const line of imported) console.log(`  ${line}`);
  }
  if (skipped.length > 0) {
    console.log(`skipped (no mapping in CREDENTIAL_TO_ENV): ${skipped.join(", ")}`);
  }
}

async function cmdRotate(): Promise<void> {
  const oldPassphrase = requirePassphrase();
  const newPassphrase = requirePassphrase(NEW_PASSPHRASE_ENV);
  if (newPassphrase === oldPassphrase) fail("new passphrase must differ from old");

  const { encrypted: oldStore } = buildCredentialStore(oldPassphrase);
  const keys = await oldStore.keys();
  if (keys.length === 0) {
    console.log("(no credentials stored — nothing to rotate)");
    return;
  }
  const decrypted = await Promise.all(keys.map(async (k) => [k, await oldStore.get(k)] as const));

  // Wipe only ciphertext (.json) files; preserve .gitkeep and any other markers.
  for (const file of readdirSync(SECRETS_DIR)) {
    if (file.endsWith(".json")) unlinkSync(join(SECRETS_DIR, file));
  }

  const { encrypted: newStore } = buildCredentialStore(newPassphrase);
  for (const [k, v] of decrypted) {
    if (v !== undefined) await newStore.put(k, v, { provider: providerForKey(k) });
  }
  console.log(
    `rotated ${keys.length} credential(s). Update ${PASSPHRASE_ENV} in your keychain / CI secret to the new value.`
  );
}

function providerForKey(key: string): string | undefined {
  if (key.startsWith("anthropic")) return "anthropic";
  if (key.startsWith("openai")) return "openai";
  if (key.startsWith("google") || key.startsWith("gemini")) return "google";
  if (key.startsWith("hf")) return "huggingface";
  return undefined;
}

function usage(): never {
  console.log(
    [
      "Usage:",
      "  bun scripts/credentials.ts set <key>           # interactive (echo off) or stdin pipe",
      "  bun scripts/credentials.ts get <key>",
      "  bun scripts/credentials.ts list",
      "  bun scripts/credentials.ts delete <key>",
      "  bun scripts/credentials.ts import-env",
      "  bun scripts/credentials.ts import-dot-env <file>  # parse a .env file",
      "  bun scripts/credentials.ts rotate              # reads new passphrase from $" +
        NEW_PASSPHRASE_ENV,
      "",
      `Requires ${PASSPHRASE_ENV} to be set. See .secrets/README.md.`,
    ].join("\n")
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "set":
      if (!args[0]) usage();
      if (args[1] !== undefined) {
        fail(
          'positional value is not accepted (would leak via shell history). Type the value when prompted, or pipe via stdin: `printf "%s\\n" "$secret" | bun scripts/credentials.ts set <key>`.'
        );
      }
      await cmdSet(args[0]);
      break;
    case "get":
      if (!args[0]) usage();
      await cmdGet(args[0]);
      break;
    case "list":
      await cmdList();
      break;
    case "delete":
      if (!args[0]) usage();
      await cmdDelete(args[0]);
      break;
    case "import-env":
      await cmdImportEnv();
      break;
    case "import-dot-env":
      if (!args[0]) usage();
      await cmdImportDotEnv(args[0]);
      break;
    case "rotate":
      await cmdRotate();
      break;
    default:
      usage();
  }
}

await main();
