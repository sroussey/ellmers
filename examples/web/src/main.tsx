//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TaskGraphBuilder } from "@ellmers/task-graph";
import "./main.css";
import {
  TaskConsoleFormatter,
  TaskGraphBuilderConsoleFormatter,
  TaskGraphBuilderHelperConsoleFormatter,
  isDarkMode,
} from "./ConsoleFormatters";

ReactDOM.createRoot(document.getElementById("root")!).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>
);

window["TaskGraphBuilder"] = TaskGraphBuilder;
window["devtoolsFormatters"] = [
  new TaskGraphBuilderConsoleFormatter(),
  new TaskGraphBuilderHelperConsoleFormatter(),
  new TaskConsoleFormatter(),
];

const dark = isDarkMode();
const grey = dark ? "#aaa" : "#333";
const yellow = dark ? "#f3ce49" : "#a68307";
const orange = dark ? "#da885e" : "#953402";

console.log("%cWelcome to Ellmers!", "color: green; font-size: 16px;");
console.log(
  "%cOpen DevTools settings, and under Console, turn on 'enable custom formatters' for best experience. Then reload the page.",
  "color: red;"
);
console.log(
  "To get started, type 'builder.reset()' in the console. Then you can build a task graph using the builder API, and it will be reflected in the web page. For example, here is how the page started: "
);
console.log(
  `  %cbuilder.%creset%c();


  builder.%cDownloadModel%c({ %cmodel%c: [%c'ONNX Xenova/LaMini-Flan-T5-783M q8']%c });
  builder.%cTextRewriter%c({ %ctext%c: %c'The quick brown fox jumps over the lazy dog.'%c, %cprompt%c: [%c'Rewrite the following text in reverse:'%c, %c'Rewrite this to sound like a pirate:'%c] });
  builder.%crename%c(%c'text'%c, %c'message'%c);
  builder.%cDebugLog%c({ %clevel%c: %c'info'%c });
  
  console.log(JSON.stringify(builder.toJSON(),null,2));
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
console.log(window["builder"]);
