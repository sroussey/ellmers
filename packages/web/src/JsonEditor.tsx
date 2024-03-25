import React, { useState, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { json } from "@codemirror/lang-json";
import { JsonTask } from "ellmers-core/browser";

import "./JsonEditor.css";

const extensions = [json()];

interface PopupProps {
  initialJson: string;
  onJsonChange: (json: string) => void;
  running: boolean;
  run: () => void;
}

export const JsonEditor: React.FC<PopupProps> = ({ initialJson, onJsonChange, run, running }) => {
  const [code, setCode] = useState<string>(initialJson);
  const [isValidJSON, setIsValidJSON] = useState<boolean>(true);

  // Function to validate JSON
  const validateJSON = (jsonString: string) => {
    try {
      // this will throw an error if the JSON is invalid
      JSON.parse(jsonString);
      // this will throw an error if the JSON is not a valid task graph
      new JsonTask({ name: "Test JSON", input: { json: jsonString } });

      setIsValidJSON(true);
      // setCode(jsonString);
      onJsonChange(jsonString);
    } catch (error) {
      setIsValidJSON(false);
    }
  };

  // Effect hook to validate JSON whenever code changes
  useEffect(() => {
    validateJSON(code);
  }, [code]);

  return (
    <div
      style={{
        flexGrow: 1,
        padding: 20,
        color: "#ddd",
        backgroundColor: "#333",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div>Enter JSON definition to run:</div>
      <div
        style={{
          flexGrow: 1,
          fontFamily: '"Fira code", "Fira Mono", monospace',
          fontSize: 12,
          border: "1px solid #3d3d3d",
          borderRadius: 4,
          marginTop: "10px",
          marginBottom: "10px",
          backgroundColor: "#222",
        }}
      >
        <CodeMirror
          value={code}
          onChange={setCode}
          theme={vscodeDark}
          extensions={extensions}
          style={{ height: "100%" }}
          aria-disabled={running}
          readOnly={running}
        />
      </div>
      <button
        disabled={!isValidJSON || running}
        onClick={() => run()}
        className="bg-black text-white p-2 rounded-md hover:bg-gray-900 disabled:opacity-50 disabled:bg-gray-950 disabled:cursor-not-allowed"
      >
        RUN
      </button>
    </div>
  );
};
