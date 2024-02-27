import database, { type Database } from "better-sqlite3";

let db: Database;
export function getDatabase(): Database {
  if (!db) {
    db = new database("foobar.db", { verbose: console.log });
    db.pragma("journal_mode = WAL");
  }
  return db;
}
