//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ILimiter } from "./ILimiter";

const jsminuteinmilliseconds = 60 * 1000;

export class RateLimiter implements ILimiter {
  private requests: Date[] = [];
  private readonly maxRequests: number;
  private readonly windowSizeInMilliseconds: number;

  constructor(maxRequests: number, windowSizeInMinutes: number) {
    this.maxRequests = maxRequests;
    this.windowSizeInMilliseconds = windowSizeInMinutes * jsminuteinmilliseconds;
  }

  private removeOldRequests() {
    const threshold = new Date(Date.now() - this.windowSizeInMilliseconds);
    this.requests = this.requests.filter((date) => date > threshold);
  }

  async canProceed(): Promise<boolean> {
    this.removeOldRequests();
    return this.requests.length < this.maxRequests;
  }

  recordJobStart(): void {
    this.requests.push(new Date());
  }

  recordJobCompletion(): void {
    // No action needed for rate limiting on job completion
  }

  async getNextAvailableTime(): Promise<Date> {
    this.removeOldRequests();
    if (await this.canProceed()) {
      return new Date(); // Can execute immediately
    } else {
      const oldestRequestTime = this.requests[0];
      // Calculate the time when the next request can be made, shifting by the window size in minutes
      return new Date(oldestRequestTime.getTime() + this.windowSizeInMilliseconds);
    }
  }
}
