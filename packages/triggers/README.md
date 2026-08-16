# @workglow/triggers

Pure-timer triggers for Workglow, plus the `Workflow` lifecycle methods that
start a workflow from one. No new dependencies, no host HTTP server, no
persistence — just `setTimeout` and the calendar, so the package runs unchanged
in Node, Bun, and the browser.

```sh
npm install @workglow/triggers
```

## Triggers

| Trigger           | Fires                                                         |
| ----------------- | ------------------------------------------------------------- |
| `IntervalTrigger` | every `intervalMs`, starting one full period after `start()`  |
| `PollingTrigger`  | only when a poll result is interesting (non-empty by default) |
| `CronTrigger`     | on the UTC instants matching a 5-field cron expression        |

```ts
import { CronTrigger, IntervalTrigger, PollingTrigger } from "@workglow/triggers";

const trigger = new CronTrigger({ expression: "0 9 * * 1-5" }); // 09:00 UTC, weekdays
trigger.on("error", (error) => console.error(error));
trigger.start(async ({ scheduledAt, signal }) => {
  await doWork({ signal });
});
// ...
await trigger.stop();
```

## Driving a workflow

Two forms, same behavior. The free functions always work; the fluent methods
exist only after `installWorkflowTriggers()`.

```ts
import { bindWorkflowTrigger, IntervalTrigger, listenWorkflow, PollingTrigger } from "@workglow/triggers";
import { Workflow } from "@workglow/task-graph";

const workflow = new Workflow().addTask(MyTask);

bindWorkflowTrigger(workflow, new IntervalTrigger({ intervalMs: 60_000 }));
bindWorkflowTrigger(workflow, new PollingTrigger({ intervalMs: 5_000, poll: () => fetchPendingIds() }), {
  input: (context) => ({ ids: context.payload }),
});

await using handle = await listenWorkflow(workflow);
```

**Importing this package installs nothing.** A module body that patched
`Workflow.prototype` would make every barrel re-exporting it side-effectful —
including `workglow`'s, which also reaches `@workglow/duckdb`, `postgres`,
`sqlite` and `mcp`, none of which declare `sideEffects`, so a bundler would have
to keep all of them in the app's bundle. Ask for the patch instead:

```ts
import { installWorkflowTriggers } from "@workglow/triggers";

installWorkflowTriggers(); // once, at startup; idempotent

workflow.trigger(new IntervalTrigger({ intervalMs: 60_000 }));
await using handle = await workflow.listen();
```

`import "workglow/auto-bootstrap"` already calls it, so the batteries-included
path keeps the fluent API. Anything else that bootstraps by hand — including
`bootstrapWorkglow()` from `workglow/bootstrap` — does not: `workflow.trigger`
is `undefined` there until you install it, and TypeScript will not warn you,
because the method declaration is a module augmentation with no way to say
"after install".

`stopWorkflowListening(workflow)` is the free-function form of
`workflow.stopListening()`.

`listen()` **resolves as soon as the triggers are scheduled — it does not block
until the process is interrupted.** It does not, however, leave the process free
to exit: a scheduled `setTimeout` is a live handle, so under Node or Bun a
started trigger keeps the process alive until it is stopped. A CLI or a test
that forgets `stop()` therefore hangs. Pass `unrefTimer: true` to any trigger
whose schedule should not by itself hold the process open. Stop with
`handle.stop()`, `workflow.stopListening()`, or by letting an `await using`
scope exit.

## Behavior worth knowing

- **Abort** — `stop()` aborts the signal handed to handlers and resolves only
  once in-flight handlers settle; concurrent `stop()` calls join the same drain.
  A tick that fails because of that abort is not reported on `error` — a
  graceful shutdown is not a fault. A caller signal passed to `start()` is
  linked with `AbortSignal.any`. Under the workflow bindings, stopping a trigger
  aborts only the workflow runs THAT trigger started — the signal is forwarded
  as `runConfig.signal`, so a second trigger bound to the same workflow keeps
  running. An `AbortSignal` that is ALREADY aborted when it reaches `listen()`
  makes `listen()` reject rather than hand back a handle whose triggers were
  never scheduled.
- **Bounding the drain** — the wait above is **unbounded by default**, and that
  default is load-bearing: it is what makes "`await stop()` means no handler of
  that run is still running" true. A handler that never settles therefore never
  lets `stop()` resolve, and through the workflow bindings that wedges
  `handle.stop()`, `workflow.stopListening()` and an `await using` scope exit
  for every other trigger on the workflow. Opt into a deadline with
  `stopTimeoutMs` on the trigger, `timeoutMs` on the `stop()` call, or
  `stopTimeoutMs` on `listen()` (which forwards to each trigger AND bounds the
  set, so a third-party `ITrigger` that ignores the option cannot wedge its
  siblings). Every deadline is a positive integer, and each is validated where
  it is supplied — `listen({ stopTimeoutMs })` at listen time, the `timeoutMs`
  on a `stop()` call as its first act — so a malformed one is never discovered
  during the shutdown it was meant to bound. A `stop()` rejected for a malformed
  deadline has attempted nothing: the session is untouched, and a corrected call
  still stops it. Past the
  deadline the still-pending handlers are **abandoned — they keep running** — a
  `TriggerStopTimeoutError` carrying the count is emitted on `error`, and the
  trigger is released so it can be started again. Under the workflow bindings
  the abandoned run is released along with the rest of the session's state, so
  the next `listen()` starts clean rather than queueing its first fire behind a
  promise nothing can settle; if that run is still going, the collision surfaces
  as a per-fire "already running" error on the trigger's `error` event.
- **A stop that resolves means everything stopped** — `handle.stop()` and
  `workflow.stopListening()` ask every trigger, report each failure through the
  logger, release the handle, and then **reject** with a `WorkflowTriggerError`
  naming the triggers whose own `stop()` rejected (`cause` carries the first
  reason). The handle is released either way: a rejected `stop()` is not
  evidence that a trigger is still scheduling, and holding the handle would lock
  `workflow.trigger(...)` out and keep handing back dead triggers. An expired
  deadline is the exception and still resolves — it is opt-in, and its
  documented outcome is a warning plus handlers that keep running.
- **A listening session is configured once** — `listen()` called again while
  already listening returns the same handle, but only when it carries no
  options. A repeat call passing `signal` or `stopTimeoutMs` throws: the handle
  is shared, so the second caller's abort would tear down the first caller's
  schedule. To change the configuration, `stopListening()` and listen again.
- **Overlap** — `overlap: "skip" | "queue" | "concurrent"`, default `"skip"`. A
  tick arriving while the previous handler runs is dropped (and emits `skip`); a
  trigger is a clock, not a work queue, so a slow handler cannot grow a backlog.
  The policy governs handler INVOCATION. A handler bound to a workflow still
  serializes at the workflow — one `Workflow` owns one task graph, and a graph
  cannot run re-entrantly — so `"concurrent"` plus a workflow binding degrades
  to queue semantics, bounded by the binding's `maxPendingFires` (default `1`).
  A fire past that bound is dropped and reported on `error`. When queueing is
  what you want, ask for it: `overlap: "queue"` with `maxQueuedFires`. A dropped
  tick emits `skip` every time; the accompanying log is collapsed to the first
  skip of a contiguous run plus a count when the run ends. `"concurrent"` is
  unbounded unless you say otherwise — a handler slower than the period gains
  one more invocation every tick, forever — so pass `maxConcurrentFires` to cap
  it; ticks past the cap degrade to skips.
- **Errors** — a handler rejection never stops the loop. It is emitted on
  `error` as the real `Error` and logged through `getLogger()`. A polling
  handler that throws does not consume the change: the baseline is restored and
  the value is offered again on the next poll that still observes it
  (at-least-once, always with the freshest result — retries are paced by the
  poll period, not by `errorBackoff`, which counts POLL failures only).
- **Hung polls** — `poll` gets no deadline by default. Pass `pollTimeoutMs` to
  bound one poll: exceeding it aborts the signal handed to `poll` and fails the
  tick with a `TriggerPollTimeoutError`, which counts as a poll failure
  (reported on `error`, and it drives `errorBackoff`). Without it, a `fetch`
  against a black-holed host keeps the tick in flight forever, and under the
  default `"skip"` policy every later tick is dropped — the trigger goes quiet
  with nothing on `error`, because a hang is not a throw.
- **Drift** — each tick is scheduled from the previous tick's scheduled instant,
  not from when its handler finished, so handler duration never accumulates.
  Waits longer than a timer's ~24.8-day ceiling are chunked.
- **Cron** — 5 fields, **UTC only**, supporting `*`, `N`, `a,b`, `a-b`, `*/n`,
  and `a-b/n`. Day-of-month and day-of-week use standard OR semantics only when
  NEITHER field begins with `*`: `0 0 1 * 1` is "the 1st **or** any Monday",
  while `0 0 */2 * 1` is "every other day **and** a Monday" — Vixie cron's
  leading-`*` rule, so a crontab line ported here means what it meant there.
  Macros (`@daily`), names (`MON`), and `L`/`W`/`#` are rejected rather than
  guessed at.
- **Delivery** — in-process and at most once. Nothing survives a restart.
