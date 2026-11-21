-- The account's sync moved to the user's own cloud (OneDrive): the pull tells the
-- account's other devices, so they link the cloud too. NULL while it syncs here.
ALTER TABLE users ADD COLUMN moved_to TEXT;
