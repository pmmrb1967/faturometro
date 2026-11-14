-- The free AI (server/src/ai-free.ts): per UTC day, sha256(day + random device id),
-- the calls and the Workers AI Neurons spent. Never the request, the IP or an account.
-- Rows of past days are deleted by the daily maintenance.
CREATE TABLE ai_free_daily (
  date TEXT NOT NULL,
  device TEXT NOT NULL,
  calls INTEGER NOT NULL,
  neurons INTEGER NOT NULL,
  PRIMARY KEY (date, device)
);
