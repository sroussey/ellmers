import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TaskGraphBuilder } from "ellmers-core/browser";
import "./main.css";
import {
  TaskGraphBuilderConsoleFormatter,
  TaskGraphBuilderTaskFormatter,
} from "./ConsoleFormatters";

ReactDOM.createRoot(document.getElementById("root")!).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>
);

window["TaskGraphBuilder"] = TaskGraphBuilder;
window["devtoolsFormatters"] = [
  new TaskGraphBuilderConsoleFormatter(),
  new TaskGraphBuilderTaskFormatter(),
];

console.log("%cWelcome to Ellmers!", "color: green; font-size: 16px;");
console.log(
  "%cOpen DevTools settings, and under Console, turn on 'enable custom formatters' for best experience.",
  "color: red;"
);
console.log(
  "To get started, type 'builder.reset()' in the console. Then you can build a task graph using the builder API: "
);
console.log(
  `  %cbuilder = new %cTaskGraphBuilder%c();

  builder
  .%cDownloadModel%c({ %cmodel%c: [%c'Xenova/LaMini-Flan-T5-783M']%c })
  .%cTextRewriter%c({ %ctext%c: %c'The quick brown fox jumps over the lazy dog.'%c, %cprompt%c: [%c'Rewrite the following text in reverse:'%c, %c'Rewrite this to sound like a pirate:'%c] })
  .%crename%c(%c'text'%c, %c'message'%c)
  .%cDebugLog%c({ %clevel%c: %c'info'%c });
  
  console.log(JSON.stringify(builder.toJSON(),null,2));
  `,
  "color: #ddd; font-weight: normal;",
  "color: #f3ce49; font-weight: normal;",
  "color: #ddd; font-weight: normal;",
  "color: #f3ce49; font-weight: bold;",
  "color: #ccc; font-weight: normal;",
  "color: #f3ce49; font-weight: normal;",
  "color: #ccc; font-weight: normal;",
  "color: #da885e; font-weight: normal;",
  "color: #ccc; font-weight: normal;",
  "color: #f3ce49; font-weight: bold;",
  "color: #ccc; font-weight: normal;",
  "color: #f3ce49; font-weight: normal;",
  "color: #ccc; font-weight: normal;",
  "color: #da885e; font-weight: normal;",
  "color: #ccc; font-weight: normal;",
  "color: #f3ce49; font-weight: normal;",
  "color: #ccc; font-weight: normal;",
  "color: #da885e; font-weight: normal;",
  "color: #ccc; font-weight: normal;",
  "color: #da885e; font-weight: normal;",
  "color: #ccc; font-weight: normal;",

  // rename
  "color: #f3ce49; font-weight: normal;",
  "color: #ddd; font-weight: normal;",
  "color: #da885e; font-weight: normal;",
  "color: #ccc; font-weight: normal;",
  "color: #da885e; font-weight: normal;",
  "color: #ccc; font-weight: normal;",

  // DebugLog
  "color: #f3ce49; font-weight: bold;",
  "color: #ccc; font-weight: normal;",
  "color: #f3ce49; font-weight: normal;",
  "color: #ccc; font-weight: normal;",
  "color: #da885e; font-weight: normal;",
  "color: #ccc; font-weight: normal;"
);
console.log(new TaskGraphBuilder());
