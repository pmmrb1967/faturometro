-- Proof that a device holds the account's master key (derived from it in the app; only its
-- SHA-256 here). Changing the password and deleting the account require it, so a session
-- token alone cannot. NULL for accounts made before it, until their app sends it once.
ALTER TABLE users ADD COLUMN owner_hash TEXT;
