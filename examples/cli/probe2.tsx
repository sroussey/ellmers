import { Task, Workflow, type IExecuteContext } from "@workglow/task-graph";
import { sleep } from "@workglow/util";

const SCHEMA = { type: "object", properties: {} } as never;

class Reporter extends Task<any, any> {
  static override readonly type = "Reporter";
  static override readonly category = "P";
  static override readonly cacheable = false;
  static override inputSchema(): never { return SCHEMA; }
  static override outputSchema(): never { return SCHEMA; }
  override async execute(_i: any, ctx: IExecuteContext) {
    for (let p = 20; p <= 60; p += 20) { await ctx.updateProgress(p, "step"); await sleep(150); }
    await sleep(900);
    return {};
  }
}
class Outer extends Task<any, any> {
  static override readonly type = "Outer";
  static override readonly category = "P";
  static override readonly cacheable = false;
  static override inputSchema(): never { return SCHEMA; }
  static override outputSchema(): never { return SCHEMA; }
  override async execute(_i: any, ctx: IExecuteContext) {
    const wf = ctx.own(new Workflow(), { title: "Inner pipeline" });
    wf.pipe(new Reporter({ title: "Reporter" }) as any);
    await wf.run({});
    return {};
  }
}

const workflow = new Workflow();
workflow.pipe(new Outer({ title: "Outer" }) as any);
workflow.graph.subscribe("graph_progress", (p) => console.log("  top graph_progress:", p));
const running = workflow.run({});
(async () => {
  await sleep(700);
  const dump = (g: any, indent: string) => {
    for (const t of g.getTasks()) {
      console.log(`${indent}${t.title ?? t.type} [${t.type}] status=${t.status} progress=${JSON.stringify(t.progress)}`);
      if (t.subGraph && t.hasChildren?.()) dump(t.subGraph, indent + "  ");
    }
  };
  console.log("\n-- tree --");
  dump(workflow.graph, " ");
  await running;
  process.exit(0);
})();
