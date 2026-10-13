-- Original files (PDF, photos), encrypted on the device, in their own D1
-- database so that a full file store never stops record sync.
-- Each file is split in chunks of base64 ciphertext (D1 values: 2 MB max).
CREATE TABLE chunks (
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  total INTEGER NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, file_id, n)
);
