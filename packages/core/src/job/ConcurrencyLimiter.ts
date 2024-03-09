//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ILimiter } from "./ILimiter";

export class ConcurrencyLimiter implements ILimiter {
  private currentRunningJobs: number = 0;
  private readonly maxConcurrentJobs: number;
  private readonly smallestDelayInMilliseconds: number;

  constructor(maxConcurrentJobs: number, smallestDelayInMilliseconds: number = 1000) {
    this.maxConcurrentJobs = maxConcurrentJobs;
    this.smallestDelayInMilliseconds = smallestDelayInMilliseconds;
  }

  async canProceed(): Promise<boolean> {
    return this.currentRunningJobs < this.maxConcurrentJobs;
  }

  recordJobStart(): void {
    if (this.currentRunningJobs < this.maxConcurrentJobs) {
      this.currentRunningJobs++;
    }
  }

  recordJobCompletion(): void {
    this.currentRunningJobs = Math.max(0, this.currentRunningJobs - 1);
  }

  async getNextAvailableTime(): Promise<Date> {
    return this.currentRunningJobs < this.maxConcurrentJobs
      ? new Date()
      : new Date(Date.now() + this.smallestDelayInMilliseconds); // Example: Assume a short delay
  }
}
