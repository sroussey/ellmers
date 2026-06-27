/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base class for all library errors. Extends the native {@link Error} so that
 * the near-universal `err instanceof Error` idiom (and the diagnostics /
 * telemetry utilities built on it) correctly classifies every domain error
 * derived from this class.
 *
 * Subclasses set their human-readable `name` from the static `type` property
 * (falling back to the runtime constructor name). An optional `cause` may be
 * supplied via the second constructor argument and is propagated to the native
 * `Error` cause chain.
 */
export class BaseError extends Error {
  public static type: string = "BaseError";

  constructor(message: string = "", options?: { cause?: unknown }) {
    super(message, options);

    const constructor = this.constructor as typeof BaseError;
    // Use the subclass's OWN `static type` when it declares one; otherwise fall
    // back to the runtime constructor name. (`BaseError.type` is inherited, so a
    // plain `constructor.type` would mask every subclass that forgets to set it.)
    this.name = Object.prototype.hasOwnProperty.call(constructor, "type")
      ? constructor.type
      : this.constructor.name;

    // Some runtimes (or super() in older targets) do not forward `cause`.
    if (options && "cause" in options && this.cause === undefined) {
      this.cause = options.cause;
    }

    // Restore the prototype chain so `instanceof` works across transpilation
    // targets that break the chain when extending built-ins.
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture a clean stack trace pointing at the construction site (V8 only).
    if (typeof Error !== "undefined" && Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }

  override toString(): string {
    return `${this.name}: ${this.message}`;
  }
}
