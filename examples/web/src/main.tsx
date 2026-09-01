/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks } from "@workglow/ai";
import {
  installDevToolsFormatters,
  isDarkMode,
  registerBaseTasks,
  Workflow,
} from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";
import ReactDOM from "react-dom/client";
import { App } from "./App";

import "./main.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>
);

installDevToolsFormatters();
const tasks = [...registerBaseTasks()];
[
  Workflow,
  ...tasks,
  ...registerCommonTasks({ fileSystemTasks: true }),
  ...registerAiTasks(),
].forEach((item) => {
  (window as any)[item.name] = item;
});

const dark = isDarkMode();
const grey = dark ? "#aaa" : "#333";
const yellow = dark ? "#f3ce49" : "#a68307";
const orange = dark ? "#da885e" : "#953402";

console.log("%cWelcome to Workglow!", "color: green; font-size: 16px;");
console.log(
  "%cOpen DevTools settings, and under Console, turn on 'enable custom formatters' for best experience. Then reload the page.",
  "color: red;"
);
console.log("console.log(Workflow.prototype):", Workflow.prototype);
console.log(
  "To get started, type 'workflow.reset()' in the console. Then you can build a task graph using the workflow API, and it will be reflected in the web page. For example, here is how the page started: "
);

const g = `color: ${grey}; font-weight: normal;`;
const y = `color: ${yellow}; font-weight: normal;`;
const yb = `color: ${yellow}; font-weight: bold;`;
const o = `color: ${orange}; font-weight: normal;`;

// Each %c consumes exactly one following style arg — keep them paired.
console.log(
  [
    `  %cworkflow = new Workflow();`,
    `  workflow.%creset%c();`,
    `  workflow.%ctextEmbedding%c({%cmodel%c: %c'onnx:Xenova/all-MiniLM-L6-v2:fp16'%c, %ctext%c: %c'The quick brown fox jumps over the lazy dog.'%c });`,
    `  workflow.%crename%c(%c'*'%c, %c'console'%c);`,
    `  workflow.%cdebugLog%c({ %clevel%c: %c'info'%c });`,
    ``,
    `  console.log(JSON.stringify(workflow.toDependencyJSON({ withBoundaryNodes: false }), null, 2));`,
  ].join("\n"),
  // workflow = ...
  g,
  // reset
  y,
  g,
  // textEmbedding({ model: '...', text: '...' })
  yb,
  g,
  y,
  g,
  o,
  g,
  yb,
  g,
  o,
  g,
  // rename('*', 'console')
  y,
  g,
  o,
  g,
  o,
  g,
  // debugLog({ level: 'info' })
  yb,
  g,
  y,
  g,
  o,
  g
);
setTimeout(() => {
  console.log("console.log(workflow):", (window as any)["workflow"]);
}, 100);
