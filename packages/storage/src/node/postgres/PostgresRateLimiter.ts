//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ILimiter } from "@ellmers/job-queue";
import { Sql } from "postgres";

/**
 * PostgreSQL implementation of a rate limiter.
 * Manages request counts and delays to control job execution.
 */
export class PostgresRateLimiter implements ILimiter {
  private readonly windowSizeInMilliseconds: number;

  constructor(
    protected readonly sql: Sql,
    private readonly queueName: string,
    private readonly maxAttempts: number,
    windowSizeInMinutes: number
  ) {
    this.windowSizeInMilliseconds = windowSizeInMinutes * 60 * 1000;
  }

  public ensureTableExists() {
    this.sql`
      CREATE TABLE IF NOT EXISTS job_rate_limit (
        id bigint SERIAL NOT NULL,
        queue_name text NOT NULL,
        attempted_at timestamp with time zone DEFAULT now(),
        next_available_at timestamp with time zone DEFAULT now()
      );
    `;
    return this;
  }

  async clear(): Promise<void> {
    await this.sql`DELETE FROM job_rate_limit`;
  }

  /**
   * Checks if a job can proceed based on rate limiting rules.
   * @returns True if the job can proceed, false otherwise
   */
  async canProceed(): Promise<boolean> {
    const now = new Date();
    const attemptedAtThreshold = new Date(now.getTime() - this.windowSizeInMilliseconds);

    // Retrieve the largest next_available_at and count of attempts in the window
    const result = await this.sql`
      SELECT 
        COUNT(*) AS attempt_count,
        MAX(next_available_at) AS latest_next_available_at
      FROM job_rate_limit
      WHERE queue_name = ${this.queueName}
        AND attempted_at > ${attemptedAtThreshold}
    `;

    const { attempt_count, latest_next_available_at } = result[0];
    const attemptCount = parseInt(attempt_count, 10);

    if (attemptCount >= this.maxAttempts) {
      // If the number of attempts exceeds or equals the max attempts, we should not proceed.
      return false;
    }

    // If latest_next_available_at is set and in the future, compare it to the current time to decide if we can proceed
    if (latest_next_available_at && new Date(latest_next_available_at) > now) {
      return false;
    }

    return true;
  }

  /**
   * Records a new job attempt.
   * @returns The ID of the added job
   */
  async recordJobStart(): Promise<void> {
    // Record a new job attempt
    await this.sql`
      INSERT INTO job_rate_limit (queue_name)
      VALUES (${this.queueName})
    `;
  }

  async recordJobCompletion(): Promise<void> {
    // Optional for rate limiting: Cleanup or track completions if needed
  }

  /**
   * Retrieves the next available time for the specific queue.
   * @returns The next available time
   */
  async getNextAvailableTime(): Promise<Date> {
    // Query for the earliest job attempt within the window that reaches the limit
    const result = await this.sql`
      SELECT attempted_at
      FROM job_rate_limit
      WHERE queue_name = ${this.queueName}
      ORDER BY attempted_at DESC
      LIMIT 1 OFFSET ${this.maxAttempts - 1}
    `;

    if (result.length > 0) {
      const earliestAttemptWithinLimit = result[0].attempted_at;
      return new Date(earliestAttemptWithinLimit.getTime() + this.windowSizeInMilliseconds);
    } else {
      return new Date();
    }
  }

  /**
   * Sets the next available time for the specific queue.
   * @param date - The new next available time
   */
  async setNextAvailableTime(date: Date): Promise<void> {
    // Update the next available time for the specific queue. If no entry exists, insert a new one.
    await this.sql`
      INSERT INTO job_rate_limit (queue_name, next_available_at)
      VALUES (${this.queueName}, ${date})
      ON CONFLICT (queue_name)
      DO UPDATE SET next_available_at = EXCLUDED.next_available_at;
    `;
  }
}
