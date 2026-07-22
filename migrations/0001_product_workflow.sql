PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS payment_workflows (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_workflow_audit_events (
  workflow_id TEXT NOT NULL REFERENCES payment_workflows(id),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (workflow_id, sequence)
);

CREATE TABLE IF NOT EXISTS authorization_replay_keys (
  replay_key TEXT PRIMARY KEY,
  receipt_hash TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES payment_workflows(id),
  consumed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_workflows_state_updated_idx
  ON payment_workflows(state, updated_at DESC);
