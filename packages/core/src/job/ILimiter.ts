//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

export interface ILimiter {
  canProceed(): Promise<boolean>;
  recordJobStart(): void;
  recordJobCompletion(): void;
  getNextAvailableTime(): Promise<Date>;
}
