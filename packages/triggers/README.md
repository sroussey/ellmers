# @workglow/triggers

Pure-timer triggers for Workglow, plus the `Workflow` lifecycle methods that
start a workflow from one. No new dependencies, no host HTTP server, no
persistence — just `setTimeout` and the calendar, so the package runs unchanged
in Node, Bun, and the browser.

```sh
npm install @workglow/triggers
```

## Triggers

| Trigger           | Fires                                                    |
| ----------------- | -------------------------------------------------------- |
| `IntervalTrigger` | every `intervalMs`, starting one full period after `start()` |
| `PollingTrigger`  | only when a poll result is interesting (non-empty by default) |
| `CronTrigger`     | on the UTC instants matching a 5-field cron expression   |

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
import "@workglow/triggers"; // patches Workflow.prototype
import { Workflow } from "@workglow/task-graph";

const workflow = new Workflow().addTask(MyTask);

workflow.trigger(new IntervalTrigger({ intervalMs: 60_000 }));
workflow.trigger(
  new PollingTrigger({ intervalMs: 5_000, poll: () => fetchPendingIds() }),
  { input: (context) => ({ ids: context.payload }) }
);

await using handle = await workflow.listen();
```

`listen()` **resolves as soon as the triggers are scheduled — it does not block
until the process is interrupted.** Keeping the process alive is the host
application's job. Stop with `handle.stop()`, `workflow.stopListening()`, or by
letting an `await using` scope exit.

## Behavior worth knowing

- **Abort** — `stop()` aborts the signal handed to handlers and resolves only
  once in-flight handlers settle. A caller signal passed to `start()` is linked
  with `AbortSignal.any`. Under the workflow bindings, stopping also aborts the
  in-flight workflow run.
- **Overlap** — `overlap: "skip" | "queue" | "concurrent"`, default `"skip"`. A
  tick arriving while the previous handler runs is dropped (and emits `skip`); a
  trigger is a clock, not a work queue, so a slow handler cannot grow a backlog.
- **Errors** — a handler rejection never stops the loop. It is emitted on
  `error` as the real `Error` and logged through `getLogger()`.
- **Drift** — each tick is scheduled from the previous tick's scheduled instant,
  not from when its handler finished, so handler duration never accumulates.
  Waits longer than a timer's ~24.8-day ceiling are chunked.
- **Cron** — 5 fields, **UTC only**, supporting `*`, `N`, `a,b`, `a-b`, `*/n`,
  and `a-b/n`. Day-of-month and day-of-week use standard OR semantics when both
  are restricted. Macros (`@daily`), names (`MON`), and `L`/`W`/`#` are rejected
  rather than guessed at.
- **Delivery** — in-process and at most once. Nothing survives a restart.
