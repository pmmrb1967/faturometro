-- Layout contributions (docs/superpowers/specs/2026-10-14-layout-contribution-design.md):
-- only the envelope encrypted for the maintainer, its size and date. No IP, no headers.
CREATE TABLE contributions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  size INTEGER NOT NULL,
  envelope TEXT NOT NULL
);
CREATE INDEX contributions_by_date ON contributions (created_at);
