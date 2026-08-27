'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'wink.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  phone       TEXT    NOT NULL,
  email       TEXT,
  date        TEXT    NOT NULL,          -- YYYY-MM-DD (the evening the guest chose)
  time        TEXT    NOT NULL,          -- HH:MM
  start_at    TEXT    NOT NULL,          -- YYYY-MM-DD HH:MM (real datetime, after-midnight rolls over)
  end_at      TEXT    NOT NULL,
  guests      INTEGER NOT NULL,
  area        TEXT    NOT NULL,
  occasion    TEXT    NOT NULL DEFAULT 'casual',
  shisha      INTEGER NOT NULL DEFAULT 0,
  shisha_count INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  lang        TEXT    NOT NULL DEFAULT 'ar',
  status      TEXT    NOT NULL DEFAULT 'pending',   -- pending|confirmed|seated|cancelled|no_show
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_date  ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_area  ON bookings(area, start_at);

CREATE TABLE IF NOT EXISTS matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  competition TEXT NOT NULL,
  team_a      TEXT NOT NULL,
  team_b      TEXT NOT NULL,
  kickoff     TEXT NOT NULL,             -- YYYY-MM-DD HH:MM
  note        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blackouts (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  date   TEXT NOT NULL UNIQUE,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL,
  message    TEXT NOT NULL,
  handled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

module.exports = db;
