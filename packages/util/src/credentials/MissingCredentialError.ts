/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseError } from "../utilities/BaseError";

/**
 * Thrown when a credential lookup against an `ICredentialStore` fails to find
 * the requested key in strict resolution mode.
 *
 * The constructor accepts the credential **key** that was looked up — never the
 * resolved or candidate secret value. The error message is built from the key
 * only and intentionally does not interpolate any value-shaped data, so this
 * error is safe to log and surface to operators without leaking secrets.
 */
export class MissingCredentialError extends BaseError {
  public static override readonly type: string = "MissingCredentialError";
  public readonly key: string;

  constructor(key: string) {
    super(`Credential "${key}" not found in configured store`);
    this.key = key;
  }
}
