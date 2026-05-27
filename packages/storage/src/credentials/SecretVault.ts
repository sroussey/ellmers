/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stores and retrieves raw secret bytes. The only shell-specific surface of
 * the desktop credential stack: Electron implements it with `safeStorage`
 * (ciphertext persisted in SQLite), Electrobun shells out to the OS keychain.
 *
 * Implementations MUST NOT log or expose secret values in errors.
 * `id` is an opaque, caller-supplied identifier (the credential store derives
 * it as `${user_id}/${project_id}/${key}`).
 */
export interface SecretVault {
  setSecret(id: string, plaintext: string): Promise<void>;
  getSecret(id: string): Promise<string | undefined>;
  deleteSecret(id: string): Promise<void>;
}
