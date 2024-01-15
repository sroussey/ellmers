//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import chalk from "chalk";
import { ListrTaskWrapper } from "listr2";

function createBar(progress: number, length: number): string {
  let distance = progress * length;
  let bar = "";
  // Add main portion
  bar += "\u2588".repeat(Math.floor(distance));
  // Add intermediate porttion
  const c = Math.round((distance % 1) * 7) + 1;
  switch (c) {
    case 1:
      bar += "\u258F";
      break;
    case 2:
      bar += "\u258E";
      break;
    case 3:
      bar += "\u258D";
      break;
    case 4:
      bar += "\u258C";
      break;
    case 5:
      bar += "\u258B";
      break;
    case 6:
      bar += "\u258A";
      break;
    case 7:
      bar += "\u2589";
      break;
    case 8:
      bar += "\u2588";
      break;
    default:
      bar += c;
  }

  // Extend empty bar
  bar += "\u258F".repeat(length > bar.length ? length - bar.length : 0);

  return chalk.rgb(
    70,
    70,
    240
  )("\u2595" + chalk.bgRgb(20, 20, 70)(bar) + "\u258F");
}

export class TaskHelper<T = any> {
  progress = 0;
  count = 0;
  max = 1;
  lastUpdate = Date.now();
  task: ListrTaskWrapper<T, any, any>;
  constructor(task: any, max: number) {
    this.task = task;
    this.max = max;
  }
  updateProgress(progress: number) {
    // console.log("progress", progress, "\n\n\n\n\n");
    this.progress = progress;
    this.task.output = createBar(this.progress, 30);
  }
  async onIteration(fn: () => Promise<void>, msg: string) {
    const start = Date.now();
    await fn();
    this.count++;
    this.progress = this.count / this.max;
    const timeSinceStart = Date.now() - start;
    const timeSinceLast = Date.now() - this.lastUpdate;
    if (timeSinceLast > 250 || timeSinceStart > 100) {
      this.task.output =
        createBar(this.progress, 30) +
        " " +
        msg +
        "  (" +
        timeSinceStart +
        "ms)" +
        " -- " +
        timeSinceLast +
        "ms";
      await Bun.sleep(1);
      Bun.gc(Date.now() % 100 === 50);
      this.lastUpdate = Date.now();
    }
  }
}
