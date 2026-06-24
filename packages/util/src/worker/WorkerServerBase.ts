/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "../di";
import { scrubStack, stackScrubRoots } from "./scrubStack";

/** Service token for the platform-specific WorkerServer instance. */
export const WORKER_SERVER = createServiceToken<WorkerServerBase>("worker.server");

/**
 * Hard cap on the completed-request bookkeeping `Set`.
 * Once exceeded, the oldest {@link EVICT_BATCH} entries are dropped.
 */
const COMPLETED_REQUESTS_HARD_CAP = 1000;

/**
 * Number of completed-request entries dropped per eviction batch once
 * {@link COMPLETED_REQUESTS_HARD_CAP} is exceeded.
 */
const EVICT_BATCH = 500;

/**
 * Extracts transferables from an object.
 * @param obj - The object to extract transferables from.
 * @returns An array of transferables.
 */
function extractTransferables(obj: any) {
  const transferables: Transferable[] = [];
  const seen = new WeakSet();

  function findTransferables(value: any) {
    // Avoid infinite recursion
    if (value && typeof value === "object" && seen.has(value)) {
      return;
    }
    if (value && typeof value === "object") {
      seen.add(value);
    }

    // Handle TypedArrays
    if (value instanceof Float32Array || value instanceof Int16Array) {
      transferables.push(value.buffer);
    }
    // Handle other TypedArrays
    else if (
      value instanceof Uint8Array ||
      value instanceof Uint8ClampedArray ||
      value instanceof Int8Array ||
      value instanceof Uint16Array ||
      value instanceof Int32Array ||
      value instanceof Uint32Array ||
      value instanceof Float64Array ||
      value instanceof BigInt64Array ||
      value instanceof BigUint64Array
    ) {
      transferables.push(value.buffer);
    }
    // Handle OffscreenCanvas
    else if (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas) {
      transferables.push(value);
    }
    // Handle ImageBitmap
    else if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
      transferables.push(value);
    }
    // Handle VideoFrame
    else if (typeof VideoFrame !== "undefined" && value instanceof VideoFrame) {
      transferables.push(value);
    }
    // Handle MessagePort
    else if (typeof MessagePort !== "undefined" && value instanceof MessagePort) {
      transferables.push(value);
    }
    // Handle ArrayBuffer
    else if (value instanceof ArrayBuffer) {
      transferables.push(value);
    }
    // Recursively search arrays and objects
    else if (Array.isArray(value)) {
      value.forEach(findTransferables);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(findTransferables);
    }
  }

  findTransferables(obj);
  return transferables;
}

/**
 * Construction-time options for {@link WorkerServerBase}.
 *
 * All fields are optional and safe to omit — defaults match the previous
 * hard-coded values.
 *
 * Reachable only via `new WorkerServerBase(...)` directly (used by tests
 * that exercise eviction-path behaviour with a tiny cap). The platform-
 * specific `WorkerServer` subclasses (`Worker.bun.ts`, `Worker.node.ts`,
 * `Worker.browser.ts`) currently have zero-arg constructors and use the
 * defaults; `new WorkerServer({ pendingAbortHardCap: ... })` will NOT
 * compile against those subclasses. To override in production either
 * bypass the subclass or extend it with a forwarding constructor.
 */
export interface WorkerServerBaseOptions {
  /**
   * Maximum number of pending-abort markers retained in memory. Once the
   * `pendingAborts` map exceeds this cap, the oldest-by-timestamp half is
   * evicted in one pass — a memory safety-net for pathological abort bursts
   * that outrun the per-id TTL timers. Defaults to `10_000`.
   *
   * Exposed as an option primarily as a test seam: tests that exercise the
   * overflow eviction path can use a tiny cap (e.g. `100`) and insert ~110
   * entries in milliseconds instead of pushing 10,010 entries through
   * vitest's fake-timer heap.
   */
  readonly pendingAbortHardCap?: number;
}

/**
 * WorkerServerBase is a class that handles messages from the main thread to the worker.
 * It is used to register functions that can be called from the main thread.
 * It also handles the transfer of transferables to the main thread.
 */
export class WorkerServerBase {
  constructor(options: WorkerServerBaseOptions = {}) {
    this.pendingAbortHardCap =
      options.pendingAbortHardCap ?? WorkerServerBase.PENDING_ABORT_HARD_CAP;
  }

  private static readonly PENDING_ABORT_TTL_MS = 30_000;
  private static readonly PENDING_ABORT_HARD_CAP = 10_000;

  /**
   * Per-instance hard cap on `pendingAborts` map size. Initialised from the
   * constructor option (defaults to {@link PENDING_ABORT_HARD_CAP}).
   */
  private readonly pendingAbortHardCap: number;

  private functions: Record<string, (...args: any[]) => Promise<any>> = {};
  private streamFunctions: Record<string, (...args: any[]) => AsyncIterable<any>> = {};
  private runFunctions: Record<
    string,
    (
      input: unknown,
      model: unknown,
      signal: AbortSignal,
      emit: (event: unknown) => void,
      outputSchema?: unknown,
      sessionId?: string
    ) => Promise<void>
  > = {};
  private previewFunctions: Record<string, (input: any, model: any) => Promise<any>> = {};

  // Keep track of each request's AbortController
  private requestControllers = new Map<string, AbortController>();
  // Keep track of requests that have already been responded to
  private completedRequests = new Set<string>();
  // Track abort messages that arrived before the corresponding call started so
  // the imminent handler can apply them immediately. Each entry's value is the
  // wall-clock timestamp (ms) at which the abort was recorded. Stale entries
  // are cleaned up by three complementary mechanisms (no inline O(n) sweep):
  //   1. A per-id `setTimeout` scheduled in {@link recordPendingAbort} drops
  //      the entry after {@link PENDING_ABORT_TTL_MS}.
  //   2. {@link consumePendingAbort} re-checks the timestamp at consume-time
  //      and treats an over-TTL marker as absent (belt-and-braces for the
  //      window between TTL-expiry and the per-id timer firing).
  //   3. A hard cap (see {@link PENDING_ABORT_HARD_CAP}) evicts the
  //      oldest-by-timestamp half when exceeded — a memory safety-net for
  //      a noisy/malicious client that spams aborts faster than the per-id
  //      timers fire.
  private pendingAborts = new Map<string, number>();
  /**
   * Per-id TTL-cleanup timer handles, keyed by request id. The contract:
   *  - Exactly one timer per live entry in `pendingAborts`. `recordPendingAbort`
   *    clears any prior timer for the same id before scheduling a new one, so
   *    a re-recorded abort always gets a full fresh TTL (previously the stale
   *    timer would still fire and delete the renewed entry early).
   *  - `consumePendingAbort` clears and removes the timer when it consumes
   *    (or treats as expired) a pending marker, so a consumed id never has
   *    a stale timer queued.
   *  - The hard-cap eviction path in `recordPendingAbort` also clears the
   *    timer for each evicted id, bounding timer-handle memory together
   *    with `pendingAborts` itself.
   *  - The TTL-fire callback removes its own entry by id.
   */
  private pendingAbortTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private postResult = (id: string, result: any) => {
    if (this.completedRequests.has(id)) {
      return; // Already responded to this request
    }
    this.completedRequests.add(id);
    const transferables = extractTransferables(result);
    const uniqueTransferables = [...new Set(transferables)];
    // @ts-expect-error - Ignore type mismatch between standard Transferable and Bun.Transferable
    postMessage({ id, type: "complete", data: result }, uniqueTransferables);
  };

  private postError = (id: string, error: unknown) => {
    if (this.completedRequests.has(id)) {
      return; // Already responded to this request
    }
    this.completedRequests.add(id);
    // Scrub absolute paths from any stack we ship to the parent and
    // omit the stack entirely in production unless the operator opts in
    // via WORKGLOW_INCLUDE_STACKS=1. Without this, build-server / container
    // / customer-deployment roots leaked through every UI that rendered
    // the rejected promise.
    const roots = stackScrubRoots();
    const includeStack =
      typeof process === "undefined" ||
      process.env?.NODE_ENV !== "production" ||
      process.env?.WORKGLOW_INCLUDE_STACKS === "1";
    let data: { message: string; name: string; stack?: string };
    if (typeof error === "string") {
      data = { message: error, name: "Error" };
    } else if (error instanceof Error) {
      data = { message: error.message, name: error.name };
      if (includeStack) {
        const scrubbed = scrubStack(error.stack, roots);
        if (scrubbed !== undefined) data.stack = scrubbed;
      }
    } else {
      data = { message: String(error), name: "Error" };
    }
    postMessage({ id, type: "error", data });
  };

  private postStreamChunk = (id: string, event: any) => {
    if (this.completedRequests.has(id)) {
      return;
    }
    postMessage({ id, type: "stream_chunk", data: event });
  };

  /**
   * Send the ready message to the main thread, advertising which functions are
   * registered in each category. Call this after all functions have been registered
   * so WorkerManager can skip unnecessary roundtrips for unregistered calls.
   */
  sendReady() {
    postMessage({
      type: "ready",
      functions: Object.keys(this.functions),
      streamFunctions: Object.keys(this.streamFunctions),
      runFunctions: Object.keys(this.runFunctions),
      previewFunctions: Object.keys(this.previewFunctions),
    });
  }

  registerFunction(name: string, fn: (...args: any[]) => Promise<any>) {
    this.functions[name] = fn;
  }

  /**
   * Register a preview function for lightweight preview execution.
   * Preview functions receive (input, model) and return a fast preview
   * without progress tracking or abort signals.
   *
   * @param name - The function name (e.g., task type identifier)
   * @param fn - Async function: (input, model) => Promise<output | undefined>
   */
  registerPreviewFunction(name: string, fn: (input: any, model: any) => Promise<any>) {
    this.previewFunctions[name] = fn;
  }

  /**
   * Register an async generator function for streaming execution.
   * When called via the worker protocol with `stream: true`, the server
   * iterates the generator and sends each yielded value as a `stream_chunk`
   * message, followed by a `complete` message when the generator finishes.
   *
   * @param name - The function name (e.g., task type identifier)
   * @param fn - Async generator function: (input, model, signal) => AsyncIterable
   */
  registerStreamFunction(name: string, fn: (...args: any[]) => AsyncIterable<any>) {
    this.streamFunctions[name] = fn;
  }

  /**
   * Register a Promise+emit run function for the new run-fn shape. The function
   * receives an `emit` callback that posts events as `stream_chunk` messages on
   * the worker port and resolves with no value when complete. Use this in place
   * of {@link registerStreamFunction} for newly-ported provider run-fns.
   */
  registerRunFunction(
    name: string,
    fn: (
      input: unknown,
      model: unknown,
      signal: AbortSignal,
      emit: (event: unknown) => void,
      outputSchema?: unknown,
      sessionId?: string
    ) => Promise<void>
  ): void {
    this.runFunctions[name] = fn;
  }

  // Handle messages from the main thread
  async handleMessage(event: { type: string; data: any }) {
    const { id, type, functionName, args, stream, run, preview } = event.data;
    if (type === "abort") {
      return await this.handleAbort(id);
    }
    if (type === "call") {
      if (stream) {
        return await this.handleStreamCall(id, functionName, args);
      }
      if (run) {
        return await this.handleRunCall(id, functionName, args);
      }
      if (preview) {
        return await this.handlePreviewCall(id, functionName, args);
      }
      return await this.handleCall(id, functionName, args);
    }
  }

  async handleAbort(id: string) {
    if (this.requestControllers.has(id)) {
      const controller = this.requestControllers.get(id);
      controller?.abort();
      this.requestControllers.delete(id);
      // Send error response back to main thread so the promise rejects
      this.postError(id, "Operation aborted");
      this.scheduleCompletedRequestCleanup(id);
      return;
    }
    // Abort arrived before the call started running (race on the message
    // port). Record the id so the imminent handle*Call can abort its
    // controller as soon as it's constructed, and surface the rejection
    // to the caller immediately.
    this.recordPendingAbort(id);
    this.postError(id, "Operation aborted");
    this.scheduleCompletedRequestCleanup(id);
  }

  /**
   * If a prior `abort` arrived for `id` before the call started, and that
   * abort is still within the TTL window, abort the supplied controller
   * immediately and drop the pending marker. Returns `true` when an abort
   * was consumed so callers may exit fast. Expired markers are silently
   * dropped (returns `false`).
   *
   * Always clears the per-id TTL timer from {@link pendingAbortTimers}
   * before returning, regardless of whether the marker was live or
   * expired — once a marker is consumed (or proven stale) its timer is
   * stale too and should not fire later.
   */
  private consumePendingAbort(id: string, controller: AbortController): boolean {
    const ts = this.pendingAborts.get(id);
    if (ts === undefined) return false;
    this.pendingAborts.delete(id);
    // Clear the per-id TTL timer: the marker is gone either way, so the
    // queued setTimeout has nothing left to delete.
    const timer = this.pendingAbortTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pendingAbortTimers.delete(id);
    }
    if (Date.now() - ts > WorkerServerBase.PENDING_ABORT_TTL_MS) {
      // Marker expired between recording and consumption — treat as absent.
      return false;
    }
    controller.abort();
    return true;
  }

  /**
   * Records `id` as having received an abort that has not yet been matched
   * to a controller. Stores a wall-clock timestamp so entries are evicted
   * by TTL (see {@link PENDING_ABORT_TTL_MS}) rather than by insertion
   * order — a noisy/malicious client spamming aborts can no longer evict
   * a legitimate pending abort before its matching `call` arrives.
   *
   * Cleanup strategy (amortised O(1) per call, no inline sweep):
   *   - A per-id `setTimeout` (tracked in {@link pendingAbortTimers},
   *     keyed by id) drops this entry once TTL elapses. If `id` already
   *     had a queued timer from a prior `recordPendingAbort`, that timer
   *     is `clearTimeout`'d first so the renewed marker gets a full
   *     fresh TTL rather than inheriting the stale +TTL of the original.
   *   - {@link consumePendingAbort} re-checks the timestamp at consume
   *     time and also clears the per-id timer so it can't fire later
   *     against an unrelated id.
   *   - If the map exceeds {@link pendingAbortHardCap}, the oldest half
   *     is evicted in one pass; each evicted id also has its timer
   *     cleared, so timer-handle memory is bounded together with the
   *     data map.
   */
  private recordPendingAbort(id: string): void {
    const now = Date.now();
    this.pendingAborts.set(id, now);

    // Re-record for an id that already had a pending marker: clear the
    // previous TTL timer so it can't fire at the original +TTL and
    // delete the renewed entry early.
    const prevTimer = this.pendingAbortTimers.get(id);
    if (prevTimer !== undefined) {
      clearTimeout(prevTimer);
      this.pendingAbortTimers.delete(id);
    }

    // Memory safety-net: if over the hard cap, evict the half with the
    // lowest timestamps (i.e. the most stale entries). This runs only on
    // the rare overflow path; the per-id `setTimeout` below handles the
    // common case in amortised O(1). Each evicted id also has its TTL
    // timer cleared so timer handles are bounded too.
    const cap = this.pendingAbortHardCap;
    if (this.pendingAborts.size > cap) {
      const entries = [...this.pendingAborts.entries()];
      entries.sort((a, b) => a[1] - b[1]); // oldest first
      const toEvict = Math.floor(entries.length / 2);
      for (let i = 0; i < toEvict; i++) {
        const evictId = entries[i][0];
        this.pendingAborts.delete(evictId);
        const evictTimer = this.pendingAbortTimers.get(evictId);
        if (evictTimer !== undefined) {
          clearTimeout(evictTimer);
          this.pendingAbortTimers.delete(evictId);
        }
      }
    }

    // Mirror `scheduleCompletedRequestCleanup`: schedule a one-shot timer
    // to drop this id after its TTL elapses. Keyed by id (not stored in
    // a Set of handles) so re-record / consume / evict can all find and
    // clear the right timer in O(1).
    const timer = setTimeout(() => {
      this.pendingAborts.delete(id);
      this.pendingAbortTimers.delete(id);
    }, WorkerServerBase.PENDING_ABORT_TTL_MS);
    this.pendingAbortTimers.set(id, timer);
  }

  /**
   * Handle a preview call. Returns undefined (non-error) if the preview
   * function is not registered, since not all task types expose a preview fn.
   */
  async handlePreviewCall(id: string, functionName: string, [input, model]: [any, any]) {
    if (!(functionName in this.previewFunctions)) {
      this.postResult(id, undefined);
      return;
    }
    try {
      const fn = this.previewFunctions[functionName];
      const result = await fn(input, model);
      this.postResult(id, result);
    } catch (error) {
      this.postError(id, error);
    }
  }

  async handleCall(id: string, functionName: string, [input, model]: [any, any]) {
    if (!(functionName in this.functions)) {
      this.postError(id, `Function ${functionName} not found`);
      return;
    }

    try {
      const abortController = new AbortController();
      this.requestControllers.set(id, abortController);
      // Honour any abort message that beat the call to the worker.
      this.consumePendingAbort(id, abortController);

      const fn = this.functions[functionName];
      const postProgress = (progress: number, message?: string, details?: any) => {
        // Don't send progress updates after the request is completed/aborted
        if (!this.completedRequests.has(id)) {
          postMessage({ id, type: "progress", data: { progress, message, details } });
        }
      };
      const result = await fn(input, model, postProgress, abortController.signal);
      this.postResult(id, result);
    } catch (error) {
      this.postError(id, error);
    } finally {
      this.requestControllers.delete(id);
      this.scheduleCompletedRequestCleanup(id);
    }
  }

  /**
   * Handle a streaming call. If a stream function is registered for the given name,
   * iterate it and send each yielded event as a `stream_chunk` message. If only a
   * regular function is registered, run it and wrap the result as a single `finish`
   * stream event (graceful fallback for providers that don't implement streaming).
   */
  async handleStreamCall(id: string, functionName: string, [input, model]: [any, any]) {
    if (functionName in this.streamFunctions) {
      try {
        const abortController = new AbortController();
        this.requestControllers.set(id, abortController);
        this.consumePendingAbort(id, abortController);

        const fn = this.streamFunctions[functionName];
        const iterable = fn(input, model, abortController.signal);

        for await (const event of iterable) {
          if (this.completedRequests.has(id)) break;
          this.postStreamChunk(id, event);
        }

        this.postResult(id, undefined);
      } catch (error) {
        this.postError(id, error);
      } finally {
        this.requestControllers.delete(id);
        this.scheduleCompletedRequestCleanup(id);
      }
    } else if (functionName in this.functions) {
      // Fallback: run regular function and wrap result as a finish stream event
      try {
        const abortController = new AbortController();
        this.requestControllers.set(id, abortController);
        this.consumePendingAbort(id, abortController);

        const fn = this.functions[functionName];
        const noopProgress = () => {};
        const result = await fn(input, model, noopProgress, abortController.signal);

        this.postStreamChunk(id, { type: "finish", data: result });
        this.postResult(id, undefined);
      } catch (error) {
        this.postError(id, error);
      } finally {
        this.requestControllers.delete(id);
        this.scheduleCompletedRequestCleanup(id);
      }
    } else {
      this.postError(id, `Function ${functionName} not found`);
    }
  }

  /**
   * Handle a Promise+emit run call. Resolves to `undefined` when the run-fn
   * settles; emitted events are forwarded as `stream_chunk` messages. This is
   * the new run-fn shape that replaces async-generator stream functions.
   */
  async handleRunCall(
    id: string,
    functionName: string,
    [input, model, outputSchema, sessionId]: [any, any, any, any]
  ) {
    if (!(functionName in this.runFunctions)) {
      this.postError(id, `Run function ${functionName} not found`);
      return;
    }
    const abortController = new AbortController();
    this.requestControllers.set(id, abortController);
    this.consumePendingAbort(id, abortController);
    const fn = this.runFunctions[functionName];

    const emit = (event: unknown) => {
      if (this.completedRequests.has(id)) return;
      this.postStreamChunk(id, event);
    };

    try {
      await fn(input, model, abortController.signal, emit, outputSchema, sessionId);
      this.postResult(id, undefined); // signals completion; no payload
    } catch (error) {
      this.postError(id, error);
    } finally {
      this.requestControllers.delete(id);
      this.scheduleCompletedRequestCleanup(id);
    }
  }

  /**
   * Schedule cleanup of a completed request ID. Uses a 5-second delay to
   * handle late-arriving abort messages, and caps the completed set size at
   * {@link COMPLETED_REQUESTS_HARD_CAP} entries to prevent unbounded growth. As in
   * {@link recordPendingAbort}, the eviction list is snapshotted via
   * `Array.from` before deletion to avoid iterating-while-deleting.
   */
  private scheduleCompletedRequestCleanup(id: string): void {
    setTimeout(() => {
      this.completedRequests.delete(id);
    }, 5000);

    // Safety cap: if the set grows too large, clear the oldest entries (FIFO).
    if (this.completedRequests.size > COMPLETED_REQUESTS_HARD_CAP) {
      const evict = Array.from(this.completedRequests).slice(0, EVICT_BATCH);
      for (const item of evict) this.completedRequests.delete(item);
    }
  }
}
