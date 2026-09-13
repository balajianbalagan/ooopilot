import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  role            TEXT,
  phone           TEXT,
  slack_user_id   TEXT,
  ooo_enabled     INTEGER NOT NULL DEFAULT 0,
  ooo_started_at  TEXT,
  ooo_ends_at     TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  jira_project_key TEXT,
  owner_id        TEXT REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id          TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id),
  project_id  TEXT REFERENCES projects(id),
  type        TEXT,                 -- ISSUE | COMMENT | STATUS | NOTE
  title       TEXT,
  content     TEXT,
  source_type TEXT NOT NULL,        -- JIRA | SLACK | CONVERSATION | MANUAL
  source_id   TEXT,
  source_url  TEXT,
  status      TEXT,                 -- Jira status when applicable
  confidence  REAL DEFAULT 1.0,
  verified    INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_source
  ON knowledge_items(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge_items(updated_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id           TEXT PRIMARY KEY,
  employee_id  TEXT REFERENCES employees(id),
  requester    TEXT,
  requester_phone TEXT,
  topic        TEXT,
  direction    TEXT DEFAULT 'OUTBOUND',   -- OUTBOUND | INBOUND_CALLBACK
  origin       TEXT DEFAULT 'SLACK',      -- SLACK | PHONE_INTAKE | SMS | WEB | API
  started_at   TEXT,
  ended_at     TEXT,
  status       TEXT DEFAULT 'PENDING',    -- PENDING | IN_PROGRESS | COMPLETED | FAILED
  summary      TEXT,
  transcript   TEXT,
  call_id      TEXT,
  confidence   REAL,
  raw_result   TEXT
);

CREATE TABLE IF NOT EXISTS conversation_items (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  type            TEXT NOT NULL,  -- QUESTION | ANSWER | NEW_INFORMATION | FOLLOW_UP | COMMITMENT | DECISION | UNRESOLVED
  content         TEXT NOT NULL,
  source          TEXT,           -- who said it
  confidence      REAL DEFAULT 0.5,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS followups (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT REFERENCES employees(id),
  conversation_id TEXT REFERENCES conversations(id),
  requester       TEXT,
  project_id      TEXT REFERENCES projects(id),
  content         TEXT NOT NULL,
  priority        TEXT DEFAULT 'normal',
  status          TEXT DEFAULT 'open',
  created_at      TEXT NOT NULL
);

-- Inbound intake: CALL-E is outbound-only, so an inbound contact is recorded
-- here and answered with an automated callback. See src/inbound/intake.ts.
CREATE TABLE IF NOT EXISTS inbound_requests (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT REFERENCES employees(id),
  channel         TEXT NOT NULL,   -- PHONE_INTAKE | SMS | WEB | SLACK | API
  from_identifier TEXT NOT NULL,   -- phone number / slack user / email
  requester_name  TEXT,
  topic           TEXT,
  status          TEXT DEFAULT 'RECEIVED', -- RECEIVED | CALLING_BACK | COMPLETED | FAILED | REJECTED
  conversation_id TEXT REFERENCES conversations(id),
  created_at      TEXT NOT NULL,
  answered_at     TEXT
);

CREATE TABLE IF NOT EXISTS processed_events (
  id           TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
`);

export const nowIso = () => new Date().toISOString();
export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Returns false if this event id was already handled (webhook de-duplication). */
export function claimEvent(eventId: string): boolean {
  try {
    db.prepare("INSERT INTO processed_events (id, processed_at) VALUES (?, ?)").run(eventId, nowIso());
    return true;
  } catch {
    return false;
  }
}
