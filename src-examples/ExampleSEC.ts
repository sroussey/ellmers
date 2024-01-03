//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Command, InvalidArgumentError } from "commander";
import { readFile } from "fs/promises";
import { Listr, PRESET_TIMER } from "listr2";
import { TaskHelper } from "./TaskHelper";
import { TextDocument } from "#/Document";
import { TransformerJsService } from "#/TransformerJsService";
import { modelList, instructList } from "#/storage/InMemory";
import { readFileSync, writeFileSync } from "fs";

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

export function AddSecCommand(program: Command) {
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
            title: "Process SEC filings",
            task: async (ctx, task) => {
              let filings = await getFilingsForCik(cik);

              if (options.form) {
                filings = filings.filter(
                  (f) => f.form === options.form.toUpperCase()
                );
              }
              const service = new TransformerJsService(modelList, instructList);

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
                  filing.documents.reduce(async (acc, document) => {
                    await acc;
                    await service.generateDocumentEmbeddings(document);
                    return acc;
                  }, Promise.resolve());
                }, `Processing ${cikStr} ${filing.accession_number}`);
              }

              writeFileSync(
                `./data-in/sec/cik-${cik}/embeddings.json`,
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
            title: "Search SEC filings",
            task: async (ctx, task) => {
              let filings = JSON.parse(
                readFileSync(`./data-in/sec/cik-${cik}/embeddings.json`, "utf8")
              ) as Filing[];

              if (options.form) {
                filings = filings.filter(
                  (f) => f.form === options.form.toUpperCase()
                );
              }
              const service = new TransformerJsService(modelList, instructList);
              const documentQuery = new TextDocument("query", query);
              await service.generateDocumentEmbeddings(documentQuery);
              console.log(documentQuery.nodes[0].embeddings[0].embedding);

              const helper = new TaskHelper(task, filings.length);
              for (const filing of filings) {
                const cikStr = cik.toString().padStart(10, "0");
                await helper.onIteration(async () => {
                  //
                }, `Processing ${cikStr} ${filing.accession_number}`);
              }
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
