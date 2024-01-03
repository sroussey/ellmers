//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Command, InvalidArgumentError } from "commander";

import { Listr, PRESET_TIMER } from "listr2";
import { TextDocument } from "#/Document";
import { TransformerJsService } from "#/TransformerJsService";
import { stategyAllPairs } from "#/storage/InMemory";

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
              const service = new TransformerJsService(stategyAllPairs);
              await service.generateDocumentEmbeddings(document);
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
