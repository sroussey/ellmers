//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Command, InvalidArgumentError } from "commander";
import { readFile } from "fs/promises";
import { Listr, PRESET_TIMER } from "listr2";
import { TaskHelper } from "./TaskHelper";
import { Document, TextDocument, TextNode } from "#/Document";
import { getPipeline } from "#/embeddings/TransformerJsService";
import {
  strategyAllPairs,
  baaiBgeSmallEnV15,
  instructPlain,
  supabaseGteSmall,
  // instructRepresent,
  instructQuestion,
  xenovaDistilbert,
  whereIsAIUAELargeV1,
  gpt2,
  xenovaDistilbertMnli,
  distilbartCnn,
} from "#/storage/InMemoryStorage";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { getTopKEmbeddings } from "#/query/InMemoryQuery";
import { Observable } from "rxjs";
import { generateDocumentEmbeddings } from "#/embeddings/GenerateEmbeddings";

interface Filing {
  cik: number;
  accession_number: string;
  primary_doc: string;
  report_date: string;
  filing_date: string;
  acceptance_date: string;
  form: string;
  file_number: string;
  film_number: string;
  documents?: TextDocument[];
}

const loadSecAccessionDocument = async (
  cik: number,
  accession_number: string,
  primary_doc: string
) => {
  const filepath = `./data-in/sec/cik-${cik}/files/${accession_number}:${primary_doc}`;
  const docraw = await readFile(filepath, "utf8");
  return docraw;
};

const processSingleFiling = async (cik: number, accession_number: string) => {
  const filing = await getFiling(cik, accession_number);

  const doc = await loadSecAccessionDocument(
    cik,
    accession_number,
    filing.primary_doc
  );

  switch (filing.form) {
    case "10-K":
      // await process10K(doc);
      break;
    case "8-K":
      return JSON.parse(doc);
    case "10-Q":
      // await process10Q(doc);
      break;
    default:
      throw new Error(`Form ${filing.form} not supported`);
  }
  return doc;
};

async function getFiling(cik: number, accession_number: string) {
  const filings = await getFilingsForCik(cik);
  const filing = filings.find(
    (filing) =>
      filing.cik === cik && filing.accession_number === accession_number
  );
  if (!filing) throw new Error("Filing not found");
  return filing;
}

let filingsCache: Filing[];
async function getFilingsForCik(this: any, cik: number): Promise<Filing[]> {
  if (filingsCache) return filingsCache;
  const filingspath = `./data-in/sec/cik-${cik}/filings.json`;
  const filingsraw = await readFile(filingspath, "utf8");
  filingsCache = JSON.parse(filingsraw) as Filing[];
  return filingsCache;
}

function myParseInt(value: string, dummyPrevious: number) {
  // parseInt takes a string and a radix
  const parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue)) {
    throw new InvalidArgumentError("Not a number.");
  }
  return parsedValue;
}

export function AddSecCommands(program: Command) {
  program
    .command("sec-index")
    .description("process sec filings")
    .argument("<cik>", "Run for only one cik", myParseInt)
    .argument("[accession]", "Run for only one accession document")
    .option("--debug", "Show debug messages")
    .option("--form [name]", "Only certain forms")
    .action(async (cik, accession, options) => {
      const listrTasks = new Listr(
        [
          {
            title: "Prepare pipelines",
            task: () => {
              return new Observable((observer) => {
                function updateProgress(stat: any) {
                  const { status, name, file, progress } = stat;
                  observer.next(`${name} ${file} ${status} ${progress}`);
                }
                async function run() {
                  await getPipeline(whereIsAIUAELargeV1, updateProgress);
                  await getPipeline(baaiBgeSmallEnV15, updateProgress);
                  await getPipeline(supabaseGteSmall, updateProgress);
                  await getPipeline(gpt2, updateProgress);
                  await getPipeline(xenovaDistilbertMnli, updateProgress);
                  await getPipeline(distilbartCnn, updateProgress);
                  observer.complete();
                }
                run();
              });
            },
          },
          {
            title: "Process SEC filings",
            task: async (ctx, task) => {
              let filings = await getFilingsForCik(cik);

              if (options.form) {
                filings = filings.filter(
                  (f) => f.form === options.form.toUpperCase()
                );
              }

              if (accession) {
                filings = filings.filter(
                  (f) => f.accession_number === accession
                );
              }

              const helper = new TaskHelper(task, filings.length);
              for (const filing of filings) {
                const cikStr = cik.toString().padStart(10, "0");
                await helper.onIteration(async () => {
                  const sections = await processSingleFiling(
                    filing.cik,
                    filing.accession_number
                  );
                  filing.documents = [
                    new TextDocument(
                      `${cikStr}:${filing.accession_number}:${filing.primary_doc}`,
                      Object.values(sections as object)
                    ),
                  ];
                  await filing.documents.reduce(async (acc, document) => {
                    await acc;
                    await generateDocumentEmbeddings(
                      strategyAllPairs,
                      document
                    );
                    return acc;
                  }, Promise.resolve());
                }, `Processing ${cikStr} ${filing.accession_number}`);
              }

              mkdirSync(`./data-out/sec/cik-${cik}`, { recursive: true });
              writeFileSync(
                `./data-out/sec/cik-${cik}/embeddings.json`,
                JSON.stringify(filings, null, 2)
              );
            },
          },
        ],
        {
          exitOnError: true,
          concurrent: false,
          rendererOptions: { timer: PRESET_TIMER },
        }
      );
      await listrTasks.run({ cik, accession, debug: options.debug });
    });

  program
    .command("sec-search")
    .description("search sec filings")
    .argument("<cik>", "Run for only one cik", myParseInt)
    .argument("<query>", "Question to ask")
    .option("--debug", "Show debug messages")
    .option("--form [name]", "Only certain forms")
    .action(async (cik, query, options) => {
      const listrTasks = new Listr(
        [
          {
            title: "Prepare pipelines",
            task: () => {
              return new Observable((observer) => {
                function updateProgress(stat: any) {
                  const { status, name, file, progress } = stat;
                  observer.next(`${name} ${file} ${status} ${progress}`);
                }
                async function run() {
                  await getPipeline(xenovaDistilbert, updateProgress);
                  await getPipeline(baaiBgeSmallEnV15, updateProgress);
                  await getPipeline(supabaseGteSmall, updateProgress);
                  observer.complete();
                }
                run();
              });
            },
          },
          {
            title: "Search SEC filings",
            task: async (ctx, task) => {
              let filings = JSON.parse(
                readFileSync(
                  `./data-out/sec/cik-${cik}/embeddings.json`,
                  "utf8"
                )
              ) as Filing[];

              // filings.forEach((f) => {
              //   f.documents?.forEach((d) => {
              //     d.nodes?.forEach((n) => {
              //       n.embeddings.forEach(
              //         (e) => (e.vector = new Float32Array(e.vector))
              //       );
              //     });
              //   });
              // });

              if (options.form) {
                filings = filings.filter(
                  (f) => f.form === options.form.toUpperCase()
                );
              }

              const docs = filings.reduce<Document[]>((acc, f) => {
                if (!f.documents) return acc;
                return acc.concat(f.documents);
              }, []);

              const nodes = docs.reduce<TextNode[]>((acc, d) => {
                if (!d.nodes) return acc;
                return acc.concat(d.nodes as TextNode[]);
              }, []);

              const queryDocument = new TextDocument("query", query);
              await generateDocumentEmbeddings(
                // strategyAllPairs,
                [
                  {
                    embeddingModel: baaiBgeSmallEnV15,
                    instruct: instructPlain,
                  },
                ],
                queryDocument
              );

              const similarities = getTopKEmbeddings(
                queryDocument.nodes[0],
                nodes,
                3
              );

              const answerer = await getPipeline(xenovaDistilbert);

              const context = similarities
                .map((s) => s.node.content)
                .join("\n\n");
              const output = await answerer(query, context);

              console.log(
                output,
                // similarities.map((s) => {
                //   return {
                //     model: s.embedding.modelName,
                //     instruct: s.embedding.instructName,
                //     similarity: s.similarity,
                //   };
                // }),
                "\n\n\n\n\n"
              );
            },
          },
        ],
        {
          exitOnError: true,
          concurrent: false,
          rendererOptions: { timer: PRESET_TIMER },
        }
      );
      await listrTasks.run({ cik, query, debug: options.debug });
    });
}
