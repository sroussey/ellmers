import React, { useCallback, useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { RunGraphFlow } from "./RunGraphFlow";
import { JsonEditor } from "./JsonEditor";
import {
  ConcurrencyLimiter,
  JsonTask,
  JsonTaskItem,
  TaskGraph,
  TaskGraphBuilder,
  TaskInput,
  TaskOutput,
} from "ellmers-core";
import {
  IndexedDbTaskGraphRepository,
  IndexedDbTaskOutputRepository,
} from "ellmers-storage/browser/indexeddb";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./Resize";
import { QueuesStatus } from "./QueueSatus";
import { OutputRepositoryStatus } from "./OutputRepositoryStatus";
import { GraphStoreStatus } from "./GraphStoreStatus";
import { InMemoryJobQueue } from "ellmers-storage/inmemory";
import { getProviderRegistry } from "ellmers-ai";
import {
  LOCAL_ONNX_TRANSFORMERJS,
  registerHuggingfaceLocalTasks,
} from "ellmers-ai-provider/hf-transformers/browser";
import {
  MEDIA_PIPE_TFJS_MODEL,
  registerMediaPipeTfJsLocalTasks,
} from "ellmers-ai-provider/tf-mediapipe/browser";
import "ellmers-task";
import "ellmers-test";
import { registerMediaPipeTfJsLocalModels } from "ellmers-test";
import { registerHuggingfaceLocalModels } from "ellmers-test";
import { env } from "@huggingface/transformers";

env.backends.onnx.wasm.proxy = true;
env.allowLocalModels = true;

const ProviderRegistry = getProviderRegistry();

registerHuggingfaceLocalTasks();
ProviderRegistry.registerQueue(
  LOCAL_ONNX_TRANSFORMERJS,
  new InMemoryJobQueue<TaskInput, TaskOutput>("local_hft", new ConcurrencyLimiter(1, 10), 10)
);

registerMediaPipeTfJsLocalTasks();
ProviderRegistry.registerQueue(
  MEDIA_PIPE_TFJS_MODEL,
  new InMemoryJobQueue<TaskInput, TaskOutput>("local_mp", new ConcurrencyLimiter(1, 10), 10)
);

ProviderRegistry.clearQueues();
ProviderRegistry.startQueues();

const taskOutputCache = new IndexedDbTaskOutputRepository();
const builder = new TaskGraphBuilder(taskOutputCache);
const run = builder.run.bind(builder);
builder.run = async () => {
  console.log("Running task graph...");
  const data = await run();
  console.log("Task graph complete.");
  return data;
};

const taskGraphRepo = new IndexedDbTaskGraphRepository();
const graph = await taskGraphRepo.getTaskGraph("default");
const resetGraph = () => {
  builder
    .reset()
    .DownloadModel({ model: ["ONNX Xenova/LaMini-Flan-T5-783M q8", "ONNX Xenova/m2m100_418M q8"] })
    .TextRewriter({
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"],
    })
    .TextTranslation({
      model: "ONNX Xenova/m2m100_418M q8",
      source: "en",
      target: "es",
    })
    .rename("text", "message")
    .rename("text", "message", -2)
    .DebugLog({ level: "info" });
  taskGraphRepo.saveTaskGraph("default", builder.graph);
};

if (graph) {
  builder.graph = graph;
} else {
  resetGraph();
}

builder.on("changed", () => {
  taskGraphRepo.saveTaskGraph("default", builder.graph);
});
builder.on("reset", () => {
  taskGraphRepo.saveTaskGraph("default", builder.graph);
});
taskGraphRepo.on("graph_cleared", () => {
  resetGraph();
  builder.emit("reset");
});
const initialJsonObj: JsonTaskItem[] = builder.toDependencyJSON();
const initialJson = JSON.stringify(initialJsonObj, null, 2);

// console access. what happens there will be reflected in the UI
window["builder"] = builder;

export const App = () => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [graph, setGraph] = useState<TaskGraph>(builder.graph);
  const [jsonData, setJsonData] = useState<string>(initialJson);

  // changes coming from builder in console
  useEffect(() => {
    async function init() {
      await registerHuggingfaceLocalModels();
      await registerMediaPipeTfJsLocalModels();
    }
    init();

    function listen() {
      setJsonData(JSON.stringify(builder.toDependencyJSON(), null, 2));
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
            <OutputRepositoryStatus repository={taskOutputCache} />
            <hr className="my-2 border-[#777]" />
            <GraphStoreStatus repository={taskGraphRepo} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
