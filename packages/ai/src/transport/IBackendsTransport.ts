/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// ────────────────────────────────────────────────────────────────────────────
// IBackendsTransport — renderer-side abstraction over the backends MessagePort
//
// Provider packages (libs) consume ONLY this interface. No Electron imports
// are permitted here; the concrete implementation lives in builder/electron.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Request payload for `IBackendsTransport.ensureRunning`.
 *
 * `backend` is a plain string (not the BackendName union) so that provider
 * packages do not need to know the closed set of backend identifiers. The
 * transport implementation in builder coerces it to BackendName.
 */
export interface IEnsureRunningRequest {
  /** Backend identifier, e.g. "llamacpp-server". */
  readonly backend: string;
  /** Absolute path to the model file. */
  readonly modelPath: string;
  /** Runtime options forwarded to the backend process. */
  readonly opts: { readonly ctx: number };
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
   * Fire-and-forget — no ack is awaited from the broker.
   */
  readonly release: () => Promise<void>;
}

/**
 * Status snapshot for a backend.
 *
 * Mirrors `IBackendStatus` from `packages/electron/src/backends-util/types.ts`
 * without importing from the builder package.
 */
export interface IBackendStatus {
  readonly state: "not-installed" | "installed" | "running" | "error";
  readonly message?: string;
  readonly pinnedVersion?: string;
}

/**
 * Renderer-side transport abstraction for the backends broker.
 *
 * The concrete implementation (`MessagePortBackendsTransport`, in builder) uses
 * `window.desktop.backends.openChannel()` to obtain a `MessagePort` and speaks
 * the protocol defined in `packages/electron/src/backends-util/protocol.ts`.
 *
 * Provider packages import ONLY this interface — no Electron / builder imports.
 */
export interface IBackendsTransport {
  /**
   * Acquire (or share) a running backend. Resolves once the backend is healthy.
   *
   * Multiple callers requesting the same `(backend, modelPath, opts.ctx)` triple
   * will share one process via the broker's refcounting. `release()` on the
   * returned handle decrements the refcount.
   */
  ensureRunning(req: IEnsureRunningRequest): Promise<IRunningHandle>;

  /**
   * Subscribe to status updates for a backend.
   *
   * The callback is called immediately (on the next port message) and on every
   * subsequent status change. Subscriptions persist across port reconnects
   * (utility crash + restart).
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
}
