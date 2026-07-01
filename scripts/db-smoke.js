const Database = require("better-sqlite3");

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );

  INSERT INTO events (event_type, occurred_at)
  VALUES ('start', '2026-07-01T14:00:00.000Z');
`);

const row = db.prepare("SELECT event_type AS type FROM events WHERE id = 1").get();
db.close();

if (row.type !== "start") {
  throw new Error("SQLite smoke test failed");
}

console.log("SQLite smoke test passed");
