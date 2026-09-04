# task-graph benchmarks

Micro-benchmarks for the `@workglow/task-graph` execution engine, written with
[Vitest's built-in benchmarking API](https://vitest.dev/guide/benchmarking).
Vitest 5 removed the top-level `bench()` export: a benchmark is now a `test()`
that takes the `bench` fixture off its context and awaits `.run()` on each
scenario.

Each file builds and runs **real** `TaskGraph` instances (real `Task`
subclasses, real `Dataflow` edges) — nothing is stubbed — so the numbers
reflect the actual scheduler, edge materializer, and stream pump.

## Scenarios

| File                      | Axis              | What it stresses                                                                                                                                                     |
| ------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wide-graph.bench.ts`     | fan-out breadth   | One source task feeding many independent leaf tasks (50 and 200). Measures dispatching a wide frontier of ready tasks and materializing many outgoing edges at once. |
| `deep-graph.bench.ts`     | dependency depth  | A long linear chain where each task consumes the previous one's output (50 and 200 deep). Nothing runs in parallel, so this isolates per-hop scheduler overhead.     |
| `streaming-pump.bench.ts` | stream throughput | An append-mode streaming task emitting many `text-delta` events (500 and 2000) into a downstream non-streaming consumer. Exercises the StreamPump accumulation path. |

## Running

Benchmarks are **not** part of the normal test run. Run them explicitly:

```sh
npx vitest bench packages/task-graph/bench
# or, without npx:
node_modules/.bin/vitest bench packages/task-graph/bench
```

`vitest bench` reports throughput (`hz`) and latency (`min` / `mean` / `p75` /
`p99`) per scenario. There are no hard perf-threshold assertions — the goal is
runnable, comparable coverage of the wide / deep / streaming axes, useful for
spotting regressions between revisions.
