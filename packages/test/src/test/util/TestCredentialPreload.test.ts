/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCredentialStore,
  CREDENTIAL_TO_ENV,
  installAndHydrate,
} from "../../../../../scripts/lib/test-credentials";

const ENV_VARS = Object.values(CREDENTIAL_TO_ENV);

describe("installAndHydrate", () => {
  let secretsDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    secretsDir = mkdtempSync(join(tmpdir(), "wg-creds-"));
    savedEnv = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));
    for (const k of ENV_VARS) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(secretsDir, { recursive: true, force: true });
  });

  it("is a no-op when no passphrase is provided", async () => {
    const result = await installAndHydrate(undefined, secretsDir);
    expect(result).toEqual({ unlocked: false, hydrated: [] });
    for (const k of ENV_VARS) expect(process.env[k]).toBeUndefined();
  });

  it("decrypts and hydrates env vars under the correct passphrase", async () => {
    const passphrase = "correct-horse-battery-staple";
    const { encrypted } = buildCredentialStore(passphrase, secretsDir);
    await encrypted.put("anthropic-api-key", "sk-ant-test");
    await encrypted.put("openai-api-key", "sk-oai-test");

    const result = await installAndHydrate(passphrase, secretsDir);
    expect(result.unlocked).toBe(true);
    expect([...result.hydrated].sort()).toEqual(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(process.env.OPENAI_API_KEY).toBe("sk-oai-test");
  });

  it("does not overwrite env vars already set in the shell", async () => {
    const passphrase = "p";
    const { encrypted } = buildCredentialStore(passphrase, secretsDir);
    await encrypted.put("anthropic-api-key", "sk-ant-from-store");
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-shell";

    const result = await installAndHydrate(passphrase, secretsDir);
    expect(result.unlocked).toBe(true);
    expect(result.hydrated).not.toContain("ANTHROPIC_API_KEY");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-from-shell");
  });

  it("leaves env untouched when the passphrase is wrong", async () => {
    const { encrypted } = buildCredentialStore("real-passphrase", secretsDir);
    await encrypted.put("anthropic-api-key", "sk-ant-test");

    const result = await installAndHydrate("wrong-passphrase", secretsDir);

    expect(result).toEqual({ unlocked: false, hydrated: [] });
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("returns unlocked:true with empty hydrated when no ciphertext exists", async () => {
    const result = await installAndHydrate("any-passphrase", secretsDir);
    expect(result).toEqual({ unlocked: true, hydrated: [] });
  });
});
