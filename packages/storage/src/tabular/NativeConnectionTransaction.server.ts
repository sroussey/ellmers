/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAlsStore, runInTransactionOnConnection } from "./ConnectionMutex.server";
import { defineNativeConnectionTransaction } from "./defineNativeConnectionTransaction";

export {
  NestedConnectionTransactionError,
  type ConnectionTxQuery,
  type RunNativeConnectionTransactionOptions,
  type RunSingleSessionConnectionTransactionOptions,
} from "./defineNativeConnectionTransaction";

export const {
  activeConnectionTxGroupHandle,
  assertNotForeignConnectionTx,
  assertSharedConnectionHandle,
  connectionTxQuery,
  deactivateConnectionTxStore,
  discardAllDeferredPuts,
  discardDeferredPuts,
  enqueueDeferredPut,
  flushDeferredPuts,
  isEnlistedInConnectionTx,
  runNativeConnectionTransaction,
  runSingleSessionConnectionTransaction,
  setConnectionTxQuery,
  takeDeferredPuts,
} = defineNativeConnectionTransaction({ getAlsStore, runInTransactionOnConnection });
