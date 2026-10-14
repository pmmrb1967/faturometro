-- Staying within the Cloudflare free plan
-- (docs/superpowers/specs/2026-10-14-sync-capacity-design.md).
-- Day of the last authenticated request (YYYY-MM-DD) and size of the
-- account's encrypted records, refreshed at most once a day.
ALTER TABLE users ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN records_bytes INTEGER NOT NULL DEFAULT 0;
UPDATE users SET last_seen_at = date('now');
UPDATE users SET records_bytes =
  (SELECT COALESCE(SUM(LENGTH(enc)), 0) FROM records WHERE records.user_id = users.id);
CREATE INDEX users_by_last_seen ON users (last_seen_at);

-- Accounts removed for inactivity: only the random id, so their devices can
-- tell "removed" from "wrong password" without revealing any email.
CREATE TABLE removed_accounts (
  id TEXT PRIMARY KEY,
  removed_at TEXT NOT NULL
);

-- Totals computed by the daily job (no personal data).
CREATE TABLE stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accounts INTEGER NOT NULL,
  records_bytes INTEGER NOT NULL,
  files_bytes INTEGER NOT NULL,
  computed_at TEXT NOT NULL
);
