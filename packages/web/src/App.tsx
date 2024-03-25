import React, { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { RunGraphFlow } from "./RunGraphFlow";
import { JsonEditor } from "./JsonEditor";
import { JsonTaskArray, TaskGraphBuilder } from "ellmers-core/browser";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./Resize";

const builder = new TaskGraphBuilder();
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
  const [jsonData, setJsonData] = useState<string>(initialJson);

  useEffect(() => {
    function listen() {
      setJsonData(JSON.stringify(builder.toJSON(), null, 2));
    }
    builder.on("changed", listen);
    return () => {
      builder.off("changed", listen);
    };
  }, []);

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel>
        <ReactFlowProvider>
          <RunGraphFlow json={jsonData} running={isRunning} setIsRunning={setIsRunning} />
        </ReactFlowProvider>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={30}>
        <JsonEditor
          json={jsonData}
          onJsonChange={(json) => setJsonData(json)}
          run={() => setIsRunning(true)}
          running={isRunning}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
