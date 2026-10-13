-- Faturómetro sync server (Cloudflare D1 / SQLite).
-- Stores accounts and end-to-end encrypted records only: never invoice data in clear.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  -- Client-side KDF parameters (PBKDF2-SHA256); the server never sees the password.
  kdf_salt TEXT NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  -- SHA-256 of the client-derived authentication key (high entropy).
  auth_hash TEXT NOT NULL,
  -- Master key wrapped by keys the server does not have (JSON).
  wrapped_key TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  -- Record type (invoices, contracts…) and last change: needed to sync.
  tbl TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  -- AES-GCM ciphertext produced on the device (JSON {iv, data}).
  enc TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX records_by_seq ON records (user_id, seq);
CREATE INDEX sessions_by_user ON sessions (user_id);
