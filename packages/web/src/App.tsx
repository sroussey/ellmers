import React, { useState, useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { RunGraphFlow } from "./RunGraphFlow";
import { PopupWithJsonEditor } from "./PopupWithJsonEditor";
import { JsonTaskArray } from "ellmers-core/browser";

const initialJsonObj: JsonTaskArray = [
  {
    id: "1",
    type: "DownloadModelTask",
    input: {
      model: "Xenova/LaMini-Flan-T5-783M",
    },
  },
  {
    id: "2",
    type: "TextRewriterTask",
    input: {
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: "Rewrite the following text in reverse:",
    },
    dependencies: {
      model: {
        id: "1",
        output: "model",
      },
    },
  },
];
const initialJson = JSON.stringify(initialJsonObj, null, 2);

export const App = () => {
  const [isPopupVisible, setIsPopupVisible] = useState<boolean>(true);
  const [jsonData, setJsonData] = useState<string>(initialJson);

  const handleJsonChange = (json: string) => {
    setJsonData(json);
  };

  const closePopup = () => {
    setIsPopupVisible(false);
  };

  return (
    <>
      <div>
        {isPopupVisible && (
          <PopupWithJsonEditor
            initialJson={jsonData}
            onJsonChange={handleJsonChange}
            closePopup={closePopup}
          />
        )}
        {/* Other content of your App */}
      </div>
      <ReactFlowProvider>
        <RunGraphFlow json={jsonData} running={!isPopupVisible} />
      </ReactFlowProvider>
    </>
  );
};
