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
[Workflow, ...tasks, ...registerCommonTasks(), ...registerAiTasks()].forEach((item) => {
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
console.log(
  `  %cworkflow = new Workflow();
  workflow.%creset%c();
  workflow.%ctextRewriter%c({%cmodel%c: %c'onnx:Xenova/LaMini-Flan-T5-783M:q8'%c, %ctext%c: %c'The quick brown fox jumps over the lazy dog.'%c, %cprompt%c: %c'Rewrite the following text in reverse:'%c });
  workflow.%crename%c(%c'*'%c, %c'console'%c);
  workflow.%cdebugLog%c({ %clevel%c: %c'info'%c });
  
  console.log(JSON.stringify(workflow.toDependencyJSON({ withBoundaryNodes: false }),null,2));
  `,
  `color: ${grey}; font-weight: normal;`,
  `color: ${yellow}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${yellow}; font-weight: bold;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${yellow}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${orange}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${yellow}; font-weight: bold;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${yellow}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${orange}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${yellow}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${orange}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${orange}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,

  // rename
  `color: ${yellow}; font-weight: normal;`,
  "color: #ddd; font-weight: normal;",
  `color: ${orange}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${orange}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,

  // DebugLog
  `color: ${yellow}; font-weight: bold;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${yellow}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`,
  `color: ${orange}; font-weight: normal;`,
  `color: ${grey}; font-weight: normal;`
);
setTimeout(() => {
  console.log("console.log(workflow):", (window as any)["workflow"]);
}, 100);
