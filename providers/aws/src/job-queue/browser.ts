/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// The AWS SDK v3 client-sqs targets Node. Browser bundles intentionally
// throw at load time to avoid silent runtime failures in browsers.
throw new Error("@workglow/aws/job-queue does not support browser runtimes");
