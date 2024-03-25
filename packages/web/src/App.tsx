import React, { useCallback, useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { RunGraphFlow } from "./RunGraphFlow";
import { JsonEditor } from "./JsonEditor";
import {
  JsonTask,
  JsonTaskArray,
  TaskGraph,
  TaskGraphBuilder,
  TaskGraphRunner,
} from "ellmers-core/browser";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./Resize";

const builder = new TaskGraphBuilder();
const run = builder.run.bind(builder);
builder.run = async () => {
  console.log("Running task graph...");
  const data = await run();
  console.log("Task graph complete.");
  return data;
};
window["builder"] = builder;
builder
  .DownloadModel({ model: ["Xenova/LaMini-Flan-T5-783M"] })
  .TextRewriter({
    text: "The quick brown fox jumps over the lazy dog.",
    prompt: ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"],
  })
  .rename("text", "message")
  .DebugLog({ level: "info" });

const initialJsonObj: JsonTaskArray = builder.toJSON();
const initialJson = JSON.stringify(initialJsonObj, null, 2);

export const App = () => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [graph, setGraph] = useState<TaskGraph>(builder._graph);
  const [jsonData, setJsonData] = useState<string>(initialJson);

  // changes coming from builder in console
  useEffect(() => {
    function listen() {
      setJsonData(JSON.stringify(builder.toJSON(), null, 2));
      setGraph(builder._graph);
    }
    builder.on("changed", listen);
    listen();
    return () => {
      builder.off("changed", listen);
    };
  }, []);

  useEffect(() => {
    function start() {
      setIsRunning(true);
    }
    function complete() {
      setIsRunning(false);
    }
    builder.on("start", start);
    builder.on("complete", complete);
    return () => {
      builder.off("start", start);
      builder.off("complete", complete);
    };
  }, []);

  const setNewJson = useCallback((json: string) => {
    const task = new JsonTask({ input: { json: json } });
    builder.clearEvents();
    builder._graph = task.subGraph;
    builder._runner = new TaskGraphRunner(builder._graph);
    builder._dataFlows = [];
    builder._error = "";
    builder.setupEvents();
    builder.events.emit("changed");
    builder.events.emit("reset");
    setJsonData(json);
  }, []);

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel>
        <ReactFlowProvider>
          <RunGraphFlow graph={graph} />
        </ReactFlowProvider>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={30}>
        <JsonEditor
          json={jsonData}
          onJsonChange={setNewJson}
          run={() => builder.run()}
          running={isRunning}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
