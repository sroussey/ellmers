/**
 * leak-demo.ts — completely standalone, no imports.
 *
 * Demonstrates the difference in V8 GC pressure / FinalizationRegistry
 * timing between FOUR patterns for invoking the same "fake inference" body:
 *
 *   A. promise   — `await body(...)` (the main-branch pattern)
 *   B. bridge    — async-generator wrapping body in the same queue + waker
 *                  + .then + .finally microtask dance bridgeProgress uses
 *                  (the leaky pattern that shipped on capabilities branch
 *                  before the fix)
 *   C. bridgefix — same as `bridge` but body wraps work in `try { } finally { }`
 *                  and nulls every captured reference in the finally — the
 *                  actual fix committed to capabilities at c9a6afa7c
 *   D. adapter   — Promise body wrapped in a single-yield generator
 *                  adapter (the experimental fix that proved the leak was
 *                  in the generator body, not in collectStream)
 *
 * Both `bridge` variants return a wrapper around a freshly-allocated
 * Float32Array. A FinalizationRegistry tracks how many wrappers are still
 * "live" (i.e. their finalizer callback has not fired yet).
 *
 * Run:
 *   bun --expose-gc scratch/leak-demo.ts promise
 *   bun --expose-gc scratch/leak-demo.ts bridge
 *   bun --expose-gc scratch/leak-demo.ts bridgefix
 *   bun --expose-gc scratch/leak-demo.ts adapter
 *
 * The numbers to watch:
 *   - liveTensors      → how many wrappers are still un-finalized
 *   - allocated/freed  → cumulative bytes
 *   - rss              → process memory (OS-visible)
 *
 * Tighten the loop (`MICROTASK_YIELD = false`) to deny V8 macrotask gaps
 * and amplify the differential. Add macrotask gaps (`MICROTASK_YIELD = true`)
 * to confirm both patterns can release memory when V8 is given the chance.
 *
 * ---------------------------------------------------------------------------
 *
 * Real-world numbers from the capabilities branch RAG suite for reference
 * (EndToEnd.integration.test.ts, 8 tests, three HFT pipelines:
 *  Qwen3-Embedding-0.6B, NeuroBERT-NER, Falconsai/text_summarization):
 *
 *   main (Promise body):                          rss = 1600 MB
 *   capabilities (bridgeProgress, no finally):    rss = 10755 MB (OOM-killed)
 *   capabilities (bridgeProgress + finally-clear): rss = 2661 MB (passes)
 *
 * The finally-clear fix recovered most of the regression but the capabilities
 * branch still uses ~2× main's memory. That extra ~1 GB is split across:
 *   - collectStream accumulator Maps allocated per call
 *   - AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]) per call
 *   - The async-generator object itself (vs Promise's smaller microtask state)
 *   - AiJob instance + its onJobProgress / abort handler closures per call
 *
 * The synthetic demo below does not capture transformers.js session caches
 * or ONNX runtime's WASM heap behaviour, so it can confirm the structural
 * fix is correct but cannot reproduce the exact 2× delta against a
 * theoretical "no dispatch overhead" baseline.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const ITERATIONS = 500;
const PAYLOAD_BYTES = 400 * 1024 * 1024; // 400 MB per call (override locally if it's too much for your box)
const REPORT_EVERY = 50;
const MICROTASK_YIELD = true; // true → setImmediate between iterations; false → tight microtask loop

// ---------------------------------------------------------------------------
// FinalizationRegistry-tracked allocator (simulates a wrapped native buffer)
// ---------------------------------------------------------------------------

const live = new Map<symbol, number>();
let allocated = 0;
let freed = 0;

const finalizer = new FinalizationRegistry<{ id: symbol; bytes: number }>(({ id, bytes }) => {
  if (live.delete(id)) freed += bytes;
});

interface Wrapper {
  data: Float32Array;
}

function alloc(): Wrapper {
  const id = Symbol();
  const bytes = PAYLOAD_BYTES;
  live.set(id, bytes);
  allocated += bytes;
  const data = new Float32Array(bytes / 4);
  // Touch some bytes so the allocation is real, not lazy
  for (let i = 0; i < data.length; i += 1024) data[i] = Math.random();
  const wrapper: Wrapper = { data };
  finalizer.register(wrapper, { id, bytes });
  return wrapper;
}

function fmt(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}

function snap(label: string): void {
  const m = process.memoryUsage();
  console.log(
    `${label.padEnd(22)} rss=${fmt(m.rss).padStart(7)} heap=${fmt(m.heapUsed).padStart(
      7
    )} live=${String(live.size).padStart(4)} alloc=${fmt(allocated).padStart(
      8
    )} freed=${fmt(freed).padStart(8)}`
  );
}

// ---------------------------------------------------------------------------
// Pattern A — PROMISE
// ---------------------------------------------------------------------------

async function bodyAsPromise(): Promise<Wrapper> {
  // Simulate "await getPipeline(...)": one promise resolution.
  const pipeline = await Promise.resolve((): Wrapper => alloc());
  // Simulate "await pipeline(...)": one more promise resolution.
  return await Promise.resolve(pipeline());
}

// ---------------------------------------------------------------------------
// Pattern B — BRIDGE (the original leaky pattern; mirrors bridgeProgress
// BEFORE the c9a6afa7c finally-clear fix)
// ---------------------------------------------------------------------------

type StreamEvent<T> =
  | { type: "phase"; message: string; progress: number | undefined }
  | { type: "finish"; data: T };

async function* bridgeProgressLeaky<T>(
  op: (onProgress: (progress: number, message?: string) => void) => Promise<T>
): AsyncGenerator<{ type: "phase"; message: string; progress: number | undefined }, T, void> {
  const queue: { type: "phase"; message: string; progress: number | undefined }[] = [];
  let waker: (() => void) | undefined;
  const wake = (): void => {
    const r = waker;
    waker = undefined;
    r?.();
  };
  const onProgress = (progress: number, message?: string): void => {
    queue.push({ type: "phase", message: message ?? "", progress });
    wake();
  };
  let result: T | undefined;
  let error: unknown;
  let settled = false;

  const promise = op(onProgress).then(
    (r) => {
      result = r;
    },
    (e) => {
      error = e;
    }
  );
  void promise.finally(() => {
    settled = true;
    wake();
  });

  while (!settled || queue.length > 0) {
    while (queue.length > 0) yield queue.shift()!;
    if (!settled) {
      await new Promise<void>((resolve) => {
        waker = resolve;
      });
    }
  }

  if (error) throw error;
  return result as T;
}

// ---------------------------------------------------------------------------
// Pattern C — BRIDGE WITH FINALLY-CLEAR (the actual fix from c9a6afa7c)
// ---------------------------------------------------------------------------

async function* bridgeProgressFixed<T>(
  op: (onProgress: (progress: number, message?: string) => void) => Promise<T>
): AsyncGenerator<{ type: "phase"; message: string; progress: number | undefined }, T, void> {
  let queue: { type: "phase"; message: string; progress: number | undefined }[] | undefined = [];
  let waker: (() => void) | undefined;
  let onProgress: ((progress: number, message?: string) => void) | undefined = (
    progress,
    message
  ) => {
    queue?.push({ type: "phase", message: message ?? "", progress });
    const r = waker;
    waker = undefined;
    r?.();
  };
  let result: T | undefined;
  let error: unknown;
  let settled = false;

  let promise: Promise<unknown> | undefined = op(onProgress).then(
    (r) => {
      result = r;
    },
    (e) => {
      error = e;
    }
  );
  void promise.finally(() => {
    settled = true;
    const r = waker;
    waker = undefined;
    r?.();
  });

  try {
    while (!settled || (queue && queue.length > 0)) {
      while (queue && queue.length > 0) yield queue.shift()!;
      if (!settled) {
        await new Promise<void>((resolve) => {
          waker = resolve;
        });
      }
    }
    if (error) throw error;
    return result as T;
  } finally {
    // Force-release every captured reference so the generator's frame
    // doesn't pin them past for-await's iterator.return().
    queue = undefined;
    waker = undefined;
    onProgress = undefined;
    promise = undefined;
    result = undefined;
    error = undefined;
  }
}

// ---------------------------------------------------------------------------
// Generator bodies for each variant
// ---------------------------------------------------------------------------

async function* bodyAsBridge(): AsyncIterable<StreamEvent<Wrapper>> {
  const pipeline = (yield* bridgeProgressLeaky(() =>
    Promise.resolve((): Wrapper => alloc())
  )) as () => Wrapper;
  const wrapper = await Promise.resolve(pipeline());
  yield { type: "finish", data: wrapper };
}

async function* bodyAsBridgeFix(): AsyncIterable<StreamEvent<Wrapper>> {
  const pipeline = (yield* bridgeProgressFixed(() =>
    Promise.resolve((): Wrapper => alloc())
  )) as () => Wrapper;
  const wrapper = await Promise.resolve(pipeline());
  yield { type: "finish", data: wrapper };
}

async function* bodyAsAdapter(): AsyncIterable<StreamEvent<Wrapper>> {
  const data = await bodyAsPromise();
  yield { type: "finish", data };
}

async function collect<T>(stream: AsyncIterable<StreamEvent<T>>): Promise<T> {
  for await (const ev of stream) {
    if (ev.type === "finish") return ev.data;
  }
  throw new Error("no finish event");
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "promise";
  const validModes = ["promise", "bridge", "bridgefix", "adapter"] as const;
  if (!(validModes as readonly string[]).includes(mode)) {
    console.error(`unknown mode: ${mode}. expected: ${validModes.join(" | ")}`);
    process.exit(1);
  }

  console.log(
    `Mode: ${mode} | iterations: ${ITERATIONS} | payload: ${fmt(
      PAYLOAD_BYTES
    )} | macrotask yield: ${MICROTASK_YIELD}`
  );
  snap("[start]");

  for (let i = 0; i < ITERATIONS; i++) {
    let w: unknown;
    if (mode === "promise") {
      w = await bodyAsPromise();
    } else if (mode === "bridge") {
      w = await collect(bodyAsBridge());
    } else if (mode === "bridgefix") {
      w = await collect(bodyAsBridgeFix());
    } else {
      w = await collect(bodyAsAdapter());
    }
    void w;

    if (MICROTASK_YIELD) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    if ((i + 1) % REPORT_EVERY === 0) snap(`[iter ${String(i + 1).padStart(4)}]`);
  }
  snap("[after loop]");

  // @ts-ignore — runtime check
  if (typeof globalThis.gc === "function") {
    // @ts-ignore
    globalThis.gc();
    snap("[after gc()]");
    await new Promise((resolve) => setTimeout(resolve, 200));
    snap("[after 200ms]");
    // @ts-ignore
    globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 200));
    snap("[after gc() x2]");
  } else {
    console.log("[hint] re-run with --expose-gc to force a final GC measurement");
  }

  console.log(
    `\nLEAK CHECK: liveTensors=${live.size} (expected ~0 if GC is keeping up; ` +
      `${ITERATIONS} means everything stayed pinned)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
