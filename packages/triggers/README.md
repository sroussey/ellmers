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

```ts
import { IntervalTrigger, PollingTrigger } from "@workglow/triggers"; // also patches Workflow.prototype
import { Workflow } from "@workglow/task-graph";

const workflow = new Workflow().addTask(MyTask);

workflow.trigger(new IntervalTrigger({ intervalMs: 60_000 }));
workflow.trigger(new PollingTrigger({ intervalMs: 5_000, poll: () => fetchPendingIds() }), {
  input: (context) => ({ ids: context.payload }),
});

await using handle = await workflow.listen();
```

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
  A caller signal passed to `start()` is linked with `AbortSignal.any`. Under
  the workflow bindings, stopping a trigger aborts only the workflow runs THAT
  trigger started — the signal is forwarded as `runConfig.signal`, so a second
  trigger bound to the same workflow keeps running.
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
  skip of a contiguous run plus a count when the run ends.
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
