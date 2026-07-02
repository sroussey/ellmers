/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_LIMITS } from "../limits";

/**
 * Options for {@link OtpPassphraseCache}.
 */
export interface OtpPassphraseCacheOptions {
  /**
   * Absolute time-to-live in milliseconds. The cache is cleared unconditionally
   * after this duration regardless of access. Default: 6 hours.
   */
  readonly hardTtlMs?: number;

  /**
   * Idle time-to-live in milliseconds. The expiry timer resets on each
   * {@link OtpPassphraseCache.retrieve} call. If both `hardTtlMs` and
   * `idleTtlMs` are set, whichever fires first wins.
   */
  readonly idleTtlMs?: number;

  /**
   * Called when the cache expires (either hard or idle TTL). Useful for
   * locking a credential store when the passphrase is no longer available.
   */
  readonly onExpiry?: () => void;
}

const DEFAULT_HARD_TTL_MS = DEFAULT_LIMITS.otpCacheHardTtlMs;

/**
 * XOR-masks a passphrase with a random one-time pad so the cache does not
 * retain the plaintext in its internal storage. The masked value and pad are
 * stored as `Uint8Array` instances and zeroed on {@link clear}. Plaintext may
 * still exist transiently as a JavaScript `string` when passed to
 * {@link store} or returned from {@link retrieve}.
 *
 * @example
 * ```ts
 * const cache = new OtpPassphraseCache({ hardTtlMs: 6 * 60 * 60 * 1000 });
 * cache.store("my-secret-passphrase");
 * const passphrase = cache.retrieve(); // "my-secret-passphrase"
 * cache.clear(); // zeroes buffers, fires onExpiry
 * cache.retrieve(); // undefined
 * ```
 */
export class OtpPassphraseCache {
  private masked: Uint8Array | undefined;
  private pad: Uint8Array | undefined;
  private hardTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly options: OtpPassphraseCacheOptions;

  constructor(options?: OtpPassphraseCacheOptions) {
    this.options = options ?? {};
  }

  /**
   * Store a passphrase in the cache, XOR-masked with a random one-time pad.
   * Any previously cached passphrase is cleared first.
   */
  store(passphrase: string): void {
    this.clearInternal(false);

    const encoder = new TextEncoder();
    const raw = encoder.encode(passphrase);
    const pad = crypto.getRandomValues(new Uint8Array(raw.length));
    const masked = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      masked[i] = raw[i] ^ pad[i];
    }

    // Zero the raw bytes now that we have masked + pad
    raw.fill(0);

    this.masked = masked;
    this.pad = pad;

    this.startTimers();
  }

  /**
   * Recover the passphrase by XOR-ing masked + pad back together.
   * Returns `undefined` if the cache is empty or expired.
   * Resets the idle timer if `idleTtlMs` is configured.
   */
  retrieve(): string | undefined {
    if (!this.masked || !this.pad) return undefined;

    const raw = new Uint8Array(this.masked.length);
    for (let i = 0; i < this.masked.length; i++) {
      raw[i] = this.masked[i] ^ this.pad[i];
    }

    const result = new TextDecoder().decode(raw);
    raw.fill(0);

    this.resetIdleTimer();
    return result;
  }

  /**
   * Whether the cache currently holds a passphrase.
   */
  get hasValue(): boolean {
    return this.masked !== undefined && this.pad !== undefined;
  }

  /**
   * Zeroes both buffers, clears timers, and fires the `onExpiry` callback.
   */
  clear(): void {
    this.clearInternal(true);
  }

  private clearInternal(fireCallback: boolean): void {
    if (this.hardTimer !== undefined) {
      clearTimeout(this.hardTimer);
      this.hardTimer = undefined;
    }
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }

    const hadValue = this.masked !== undefined;

    if (this.masked) {
      this.masked.fill(0);
      this.masked = undefined;
    }
    if (this.pad) {
      this.pad.fill(0);
      this.pad = undefined;
    }

    if (fireCallback && hadValue && this.options.onExpiry) {
      this.options.onExpiry();
    }
  }

  private startTimers(): void {
    const hardTtl = this.options.hardTtlMs ?? DEFAULT_HARD_TTL_MS;
    this.hardTimer = setTimeout(() => this.clear(), hardTtl);
    // Unref so the timer doesn't keep the process alive
    if (typeof this.hardTimer === "object" && "unref" in this.hardTimer) {
      this.hardTimer.unref();
    }

    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }

    const idleTtl = this.options.idleTtlMs;
    if (idleTtl !== undefined && this.masked !== undefined) {
      this.idleTimer = setTimeout(() => this.clear(), idleTtl);
      if (typeof this.idleTimer === "object" && "unref" in this.idleTimer) {
        this.idleTimer.unref();
      }
    }
  }
}
