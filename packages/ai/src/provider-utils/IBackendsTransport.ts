/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// ────────────────────────────────────────────────────────────────────────────
// IBackendsTransport — renderer-side abstraction over backend transport
//
// Provider packages (libs) consume ONLY this interface. No platform-specific
// imports are permitted here; concrete implementations live elsewhere.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Request payload for `IBackendsTransport.ensureRunning`.
 *
 * `backend` is a plain string (not the BackendName union) so that provider
 * packages do not need to know the closed set of backend identifiers. The
 * transport implementation resolves it to the host's concrete backend identifier.
 */
export interface IEnsureRunningRequest {
  /** Backend identifier, e.g. "llamacpp-server". */
  readonly backend: string;
  /** Absolute path to the model file. */
  readonly modelPath: string;
  /**
   * Backend-specific runtime options forwarded to the broker as opaque JSON.
   * llamacpp uses `{ ctx: number }`; sd-cpp passes an empty object `{}`;
   * future backends define their own schema.
   */
  readonly opts: Readonly<Record<string, unknown>>;
}

/**
 * Handle returned by a successful `ensureRunning` call.
 *
 * Callers MUST call `release()` when done to decrement the broker's refcount.
 * After all handles for a backend are released, the broker may shut down the
 * backend process after its idle timeout.
 */
export interface IRunningHandle {
  /** Base URL of the running backend, e.g. "http://127.0.0.1:8765". */
  readonly url: string;
  /**
   * Decrements the broker's refcount for this handle. The backend may shut
   * down after the broker's idle timeout if refcount reaches zero.
   *
   * The returned promise resolves once the release message has been posted
   * to the port; the broker does not acknowledge. Errors posting (e.g. port
   * closed) reject.
   */
  readonly release: () => Promise<void>;
}

/**
 * Status snapshot for a backend.
 *
 * Mirrors the host transport's backend status snapshot shape without coupling
 * this shared interface to any package-private implementation path.
 */
export interface IBackendStatus {
  readonly state: "not-installed" | "installed" | "running" | "error";
  readonly message: string | undefined;
  readonly pinnedVersion: string | undefined;
}

/**
 * Renderer-side transport abstraction for the backends broker.
 *
 * Concrete implementations obtain a channel from their host environment and
 * speak whatever request/response protocol that host defines.
 *
 * Provider packages import ONLY this interface — no platform-specific imports.
 */
export interface IBackendsTransport {
  /**
   * Acquire (or share) a running backend. Resolves once the backend is healthy.
   *
   * Multiple callers requesting the same `(backend, modelPath, opts)` triple
   * will share one process via the broker's refcounting. `release()` on the
   * returned handle decrements the refcount.
   */
  ensureRunning(req: IEnsureRunningRequest): Promise<IRunningHandle>;

  /**
   * Subscribe to status updates for a backend.
   *
   * The callback fires on every subsequent broker `status` event; callers
   * wanting an initial snapshot must invoke `list()`. Subscriptions persist
   * across port reconnects. Implementations MUST be idempotent: calling the
   * returned unsubscribe twice is a no-op; subscribing the same callback
   * twice is allowed and de-duplicated.
   *
   * @returns An unsubscribe function. Call it to stop receiving updates.
   */
  subscribeStatus(backend: string, callback: (status: IBackendStatus) => void): () => void;

  /**
   * Install a backend (download + verify + extract). Resolves when the backend
   * reaches the "installed" state. Rejects on download / verification failure.
   *
   * Progress is reported via the optional callback as `(bytesReceived, totalBytes)`.
   * `total` may be 0 if the content-length is unknown.
   */
  install(backend: string, onProgress?: (bytes: number, total: number) => void): Promise<void>;

  /**
   * Fire-and-forget request for the broker to broadcast a `status`
   * event for every backend in its registry. Resolves once the request
   * has been posted (the broker does not send a discrete reply).
   */
  list(): Promise<void>;

  /**
   * Removes the backend's installed binary. In v1 the broker rejects
   * this with an error; callers should handle the rejection. Future
   * versions may implement teardown semantics.
   */
  uninstall(backend: string): Promise<void>;
}
