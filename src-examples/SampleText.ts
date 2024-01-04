//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Command, InvalidArgumentError } from "commander";

import { Listr, PRESET_TIMER } from "listr2";
import { TextDocument } from "#/Document";
import { strategyAllPairs } from "#/storage/InMemoryStorage";
import { generateDocumentEmbeddings } from "#/embeddings/GenerateEmbeddings";

export function AddSampleCommand(program: Command) {
  program
    .command("sample")
    .description("process sample text")
    .action(async (options) => {
      const listrTasks = new Listr(
        [
          {
            title: "Data Sample",
            task: async (ctx, task) => {
              task.title = `DATA`;
              const document = new TextDocument("test", "This is a test");
              task.output = `Document: ${document.title}`;
              await generateDocumentEmbeddings(strategyAllPairs, document);
              console.log("\n\n\n\n\n");
            },
          },
        ],
        {
          exitOnError: true,
          concurrent: false,
          rendererOptions: { timer: PRESET_TIMER },
        }
      );
      await listrTasks.run({});
    });
}
