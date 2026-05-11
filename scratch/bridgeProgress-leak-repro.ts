/**
 * Self-contained reproducer for the bridgeProgress / async-generator
 * memory leak observed on the `capabilities` branch.
 *
 * No ONNX, no transformers.js, no @workglow imports — just plain Node/Bun
 * and large Float32Array allocations to simulate the per-call tensor
 * allocations that an HFT run-fn does.
 *
 * Run:
 *   bun scratch/bridgeProgress-leak-repro.ts promise   # baseline (Promise body)
 *   bun scratch/bridgeProgress-leak-repro.ts bridge    # leaky pattern
 *   bun scratch/bridgeProgress-leak-repro.ts adapter   # Promise body wrapped in 1-yield generator
 *
 * Expected:
 *   - `promise` and `adapter` rss stays roughly flat (within GC noise) across
 *     iterations; ends at a few hundred MB.
 *   - `bridge` rss climbs per iteration; ends multiple GB higher than the
 *     other two for the same workload.
 *
 * Tweak ITERATIONS and TENSOR_BYTES at the top to reproduce more or less
 * aggressively.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const ITERATIONS = 500; // how many times to run the inner body
const TENSOR_BYTES = 4 * 1024 * 1024; // 4 MB per fake tensor (Float32Array of 1M floats)
const PROGRESS_TICKS = 0; // simulate N progress callback calls per inference; 0 == no progress (the cache-hit hot path)
const REPORT_EVERY = 25; // print rss every N iterations

// ---------------------------------------------------------------------------
// Stream event types — mirror @workglow/task-graph's StreamEvent shape
// ---------------------------------------------------------------------------

type StreamPhase = { type: "phase"; message: string; progress: number | undefined };
type StreamFinish<T> = { type: "finish"; data: T };
type StreamEvent<T> = StreamPhase | StreamFinish<T>;

interface FakePipeline {
  /**
   * Returns a Float32Array of size TENSOR_BYTES / 4 with random values.
   * Mimics an ONNX tensor whose `.data` view is backed by a fresh ArrayBuffer.
   */
  (text: string): Promise<{ data: Float32Array; dispose: () => void }>;
}

// ---------------------------------------------------------------------------
// FinalizationRegistry-based "WASM heap" simulation
// ---------------------------------------------------------------------------
//
// Real ONNX-runtime tensors hold native (WASM) memory that V8 does NOT track
// in heapUsed/external. Their JS wrapper has a FinalizationRegistry entry
// that fires *eventually* (on V8's GC schedule) and frees the native memory.
//
// We simulate that by tracking "live native allocations" in a Set keyed by
// the wrapper's symbol. The finalizer removes the entry. We then report
// `live` count alongside `process.memoryUsage()` so we can see whether GC
// is keeping up under each pattern even though plain ArrayBuffer accounting
// looks identical.

const liveNativeAllocations = new Map<symbol, number>(); // id → bytes
let totalAllocated = 0n;
let totalFreed = 0n;

const tensorFinalizer = new FinalizationRegistry<{ id: symbol; bytes: number }>((held) => {
  liveNativeAllocations.delete(held.id);
  totalFreed += BigInt(held.bytes);
});

function fakeWasmAlloc(bytes: number): { data: Float32Array; dispose: () => void } {
  const id = Symbol();
  liveNativeAllocations.set(id, bytes);
  totalAllocated += BigInt(bytes);
  const data = new Float32Array(bytes / 4).fill(Math.random());
  // touch a few bytes so it's a real allocation
  for (let i = 0; i < data.length; i += 4096) data[i] = Math.random();
  const wrapper = {
    data,
    dispose: (): void => {
      if (liveNativeAllocations.delete(id)) {
        totalFreed += BigInt(bytes);
      }
    },
  };
  tensorFinalizer.register(wrapper, { id, bytes });
  return wrapper;
}

function liveBytes(): number {
  let n = 0;
  for (const b of liveNativeAllocations.values()) n += b;
  return n;
}

// Module-level "pipeline cache" so getPipeline() returns instantly on repeat
// calls (mimics HFT's cached pipeline path — the hot path).
let cachedPipeline: FakePipeline | undefined;

async function getFakePipeline(
  onProgress: (progress: number, message?: string) => void,
  signal: AbortSignal
): Promise<FakePipeline> {
  // Fire optional progress events so callers exercise the progress callback
  // path even on cache hits.
  for (let i = 0; i < PROGRESS_TICKS; i++) {
    onProgress((i / PROGRESS_TICKS) * 100, `tick ${i}`);
  }
  if (cachedPipeline) return cachedPipeline;
  cachedPipeline = async (_text: string) => {
    // Simulate an ONNX inference: allocate a tracked "WASM tensor" via the
    // FinalizationRegistry-backed allocator above. Each call adds `TENSOR_BYTES`
    // to liveNativeAllocations until V8 GCs the wrapper and the finalizer
    // fires (or until dispose() is called explicitly).
    return fakeWasmAlloc(TENSOR_BYTES);
  };
  return cachedPipeline;
}

// ---------------------------------------------------------------------------
// bridgeProgress — copied verbatim from packages/ai/src/capability/bridgeProgress.ts
// ---------------------------------------------------------------------------

async function* bridgeProgress<T>(
  op: (onProgress: (progress: number, message?: string) => void) => Promise<T>
): AsyncGenerator<StreamPhase, T, void> {
  const queue: StreamPhase[] = [];
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
    while (queue.length > 0) {
      yield queue.shift()!;
    }
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
// collectStream — minimal version (matches packages/ai/src/capability/collectStream.ts
// behaviour for the "single finish event" case used here).
// ---------------------------------------------------------------------------

async function collectStream<T>(stream: AsyncIterable<StreamEvent<T>>): Promise<T> {
  let finished = false;
  let finishData: T | undefined;
  for await (const event of stream) {
    if (event.type === "finish") {
      finished = true;
      finishData = event.data;
      break;
    }
    // phase ignored
  }
  if (!finished) throw new Error("Stream ended without finish event");
  return finishData as T;
}

// ---------------------------------------------------------------------------
// Three run-fn variants
// ---------------------------------------------------------------------------

interface RunOutput {
  vector: Float32Array;
}

/** Variant A: pure Promise body — matches `main` branch's HFT_TextEmbedding. */
async function runFnPromise(text: string, signal: AbortSignal): Promise<RunOutput> {
  const pipeline = await getFakePipeline(() => {}, signal);
  const tensor = await pipeline(text);
  return { vector: tensor.data };
}

/**
 * Variant B: async generator body that wraps getPipeline in bridgeProgress —
 * matches `capabilities` branch's HFT_TextEmbedding (the leaky pattern).
 */
async function* runFnBridge(
  text: string,
  signal: AbortSignal
): AsyncIterable<StreamEvent<RunOutput>> {
  const pipeline = (yield* bridgeProgress((onProgress) =>
    getFakePipeline(onProgress, signal)
  )) as FakePipeline;
  const tensor = await pipeline(text);
  yield { type: "finish", data: { vector: tensor.data } };
}

/**
 * Variant C: Promise body wrapped in a single-yield generator adapter —
 * matches the experimental fix that brought rss back down to main's level.
 */
async function* runFnAdapter(
  text: string,
  signal: AbortSignal
): AsyncIterable<StreamEvent<RunOutput>> {
  const data = await runFnPromise(text, signal);
  yield { type: "finish", data };
}

// ---------------------------------------------------------------------------
// Memory reporter
// ---------------------------------------------------------------------------

function fmt(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}

function logMem(prefix: string): void {
  const m = process.memoryUsage();
  console.log(
    `${prefix} rss=${fmt(m.rss)} heapUsed=${fmt(m.heapUsed)} external=${fmt(
      m.external
    )} liveTensors=${liveNativeAllocations.size} liveBytes=${fmt(liveBytes())} alloc=${fmt(
      Number(totalAllocated)
    )} freed=${fmt(Number(totalFreed))}`
  );
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "promise";
  if (!["promise", "bridge", "adapter"].includes(mode)) {
    console.error(`unknown mode: ${mode}. expected: promise | bridge | adapter`);
    process.exit(1);
  }

  console.log(
    `Mode: ${mode} | iterations: ${ITERATIONS} | tensor: ${fmt(TENSOR_BYTES)} | progress ticks/call: ${PROGRESS_TICKS}`
  );
  logMem("[start]");

  const signal = new AbortController().signal;

  for (let i = 0; i < ITERATIONS; i++) {
    if (mode === "promise") {
      const result = await runFnPromise(`text-${i}`, signal);
      // Drop reference so GC can reclaim
      void result;
    } else if (mode === "bridge") {
      const result = await collectStream(runFnBridge(`text-${i}`, signal));
      void result;
    } else {
      const result = await collectStream(runFnAdapter(`text-${i}`, signal));
      void result;
    }

    // Yield to the macrotask queue every iteration so V8 has a chance to
    // run idle GC. Without this, even Promise mode shows 0 freed because
    // tight async loops deny V8's incremental GC scheduler. Real ONNX
    // workloads naturally have macrotask gaps via setTimeout/setImmediate
    // calls inside transformers.js.
    await new Promise((resolve) => setTimeout(resolve, 1));

    if ((i + 1) % REPORT_EVERY === 0) {
      logMem(`[iter ${i + 1}]`);
    }
  }

  logMem("[end]");

  // Optional: force GC if --expose-gc is on, then re-measure
  // @ts-ignore
  if (typeof globalThis.gc === "function") {
    // @ts-ignore
    globalThis.gc();
    logMem("[after gc()]");
  } else {
    console.log("[hint] re-run with --expose-gc to force a final GC measurement");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
