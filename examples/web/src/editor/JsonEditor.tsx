/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { json } from "@codemirror/lang-json";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import CodeMirror from "@uiw/react-codemirror";
import { JsonTask } from "@workglow/tasks";
import React, { useCallback, useState } from "react";

import "./JsonEditor.css";

const extensions = [json()];

interface PopupProps {
  json: string;
  onJsonChange: (json: string) => void;
  running: boolean;
  aborting: boolean;
  run: () => void;
  stop: () => void;
}

function isValidTaskJson(jsonString: string): boolean {
  try {
    JSON.parse(jsonString);
    new JsonTask({ title: "Test JSON", defaults: { json: jsonString } });
    return true;
  } catch {
    return false;
  }
}

export const JsonEditor: React.FC<PopupProps> = ({
  json,
  onJsonChange,
  run,
  stop,
  running,
  aborting,
}) => {
  const [code, setCode] = useState<string>(json);
  const [isValidJSON, setIsValidJSON] = useState<boolean>(() => isValidTaskJson(json));
  const [lastExternalJson, setLastExternalJson] = useState(json);
  if (json !== lastExternalJson) {
    setLastExternalJson(json);
    setCode(json);
    setIsValidJSON(isValidTaskJson(json));
  }

  const handleCodeChange = useCallback(
    (jsonString: string) => {
      setCode(jsonString);
      const valid = isValidTaskJson(jsonString);
      setIsValidJSON(valid);
      if (valid) {
        onJsonChange(jsonString);
      }
    },
    [onJsonChange]
  );

  return (
    <div className="flex h-full w-full p-6 bg-[#333] text-[#ddd] flex-col">
      <div>Enter JSON definition to run:</div>
      <div className="flex-1 border-1 border-[#3d3d3d] rounded-md mt-2 mb-2 bg-[#222] text-xs">
        <CodeMirror
          value={code}
          onChange={handleCodeChange}
          theme={vscodeDark}
          extensions={extensions}
          style={{ height: "100%" }}
          aria-disabled={running}
          readOnly={running}
        />
      </div>
      {!running && (
        <button
          disabled={!isValidJSON}
          onClick={run}
          className="bg-black text-white p-2 rounded-md hover:bg-gray-900 disabled:opacity-50 disabled:bg-gray-950 disabled:cursor-not-allowed"
        >
          RUN
        </button>
      )}
      {running && (
        <button
          disabled={aborting}
          onClick={stop}
          className="bg-black text-white p-2 rounded-md hover:bg-gray-900 disabled:opacity-50 disabled:bg-gray-950 disabled:cursor-not-allowed"
        >
          STOP
        </button>
      )}
    </div>
  );
};
