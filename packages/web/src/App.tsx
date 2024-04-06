import React, { useCallback, useEffect, useState } from "react";
import { ReactFlowProvider } from "@sroussey/xyflow-react";
import { RunGraphFlow } from "./RunGraphFlow";
import { JsonEditor } from "./JsonEditor";
import {
  IndexedDbTaskOutputRepository,
  JsonTask,
  TaskGraph,
  TaskGraphBuilder,
  TaskGraphRunner,
} from "ellmers-core/browser";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./Resize";
import { QueuesStatus } from "./QueueSatus";
import { RepositoryStatus } from "./RepositoryStatus";

const taskOutputCache = new IndexedDbTaskOutputRepository();
const builder = new TaskGraphBuilder(taskOutputCache);
const run = builder.run.bind(builder);
builder.run = async () => {
  console.log("Running task graph...");
  const data = await run();
  console.log("Task graph complete.");
  return data;
};

builder
  .DownloadModel({ model: ["Xenova/LaMini-Flan-T5-783M", "Xenova/m2m100_418M"] })
  .TextRewriter({
    text: "The quick brown fox jumps over the lazy dog.",
    prompt: ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"],
  })
  .TextTranslation({
    model: "Xenova/m2m100_418M",
    source: "en",
    target: "es",
  })
  .rename("text", "message")
  .rename("text", "message", -2)
  .DebugLog({ level: "info" });

const initialJsonObj: JsonTask[] = builder.toDependencyJSON();
const initialJson = JSON.stringify(initialJsonObj, null, 2);

window["builder"] = builder;

export const App = () => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [graph, setGraph] = useState<TaskGraph>(builder.graph);
  const [jsonData, setJsonData] = useState<string>(initialJson);

  // changes coming from builder in console
  useEffect(() => {
    function listen() {
      setJsonData(JSON.stringify(builder.toJSON(), null, 2));
      setGraph(builder.graph);
    }
    builder.on("changed", listen);
    builder.on("reset", listen);
    listen();
    return () => {
      builder.off("changed", listen);
      builder.off("reset", listen);
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
    builder.graph = task.subGraph;
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
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={82}>
            <JsonEditor
              json={jsonData}
              onJsonChange={setNewJson}
              run={() => builder.run()}
              running={isRunning}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel style={{ backgroundColor: "#222", color: "#bbb", padding: "10px" }}>
            <QueuesStatus />
            <hr className="my-2 border-[#777]" />
            <RepositoryStatus repository={taskOutputCache} />
            <br />
            <RepositoryStatus repository={repo} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
