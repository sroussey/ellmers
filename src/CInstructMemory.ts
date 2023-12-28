//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { CInstruct } from "./CInstruct";
import { IInstructList } from "./IInstruct";

export class CInstructMemory extends CInstruct {}

export const instructList: IInstructList = [
  new CInstructMemory(
    "Plain",
    "The plain version does nothing extra to queries or storage",
    "",
    "",
    {}
  ),
  new CInstructMemory(
    "HighTemp",
    "This is similar to plain but with a higher temperature and four versions averaged together",
    "",
    "",
    { temperature: 0.5, number: 4 }
  ),
  new CInstructMemory(
    "Represent",
    "This tries to coax the model into representing the query or passage",
    "Represent this query for searching relevant passages: ",
    "Represent this passage for later retrieval: ",
    {}
  ),
];
