import React, { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { RunGraphFlow } from "./RunGraphFlow";
import { JsonEditor } from "./JsonEditor";
import { JsonTaskArray, ModelUseCaseEnum, findModelByUseCase } from "ellmers-core/browser";

const initialJsonObj: JsonTaskArray = [
  {
    id: "1",
    type: "DownloadModelCompoundTask",
    input: {
      model: ["Xenova/LaMini-Flan-T5-783M"],
    },
  },
  {
    id: "2",
    type: "TextRewriterCompoundTask",
    input: {
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"],
    },
    dependencies: {
      model: {
        id: "1",
        output: "model",
      },
    },
  },
  {
    id: "3",
    type: "DebugLogTask",
    input: {
      level: "info",
    },
    dependencies: {
      message: {
        id: "2",
        output: "text",
      },
    },
  },
];
const initialJson = JSON.stringify(initialJsonObj, null, 2);

export const App = () => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [jsonData, setJsonData] = useState<string>(initialJson);

  return (
    <>
      <ReactFlowProvider>
        <RunGraphFlow json={jsonData} running={isRunning} setIsRunning={setIsRunning} />
      </ReactFlowProvider>
      <JsonEditor
        initialJson={jsonData}
        onJsonChange={(json) => setJsonData(json)}
        run={() => setIsRunning(true)}
        running={isRunning}
      />
    </>
  );
};
