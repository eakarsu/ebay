ALTER TABLE commerce_identities ADD COLUMN IF NOT EXISTS password_digest text;

ALTER TABLE commerce_identities DROP CONSTRAINT IF EXISTS commerce_identity_password_format;
ALTER TABLE commerce_identities ADD CONSTRAINT commerce_identity_password_format
  CHECK (password_digest IS NULL OR password_digest LIKE 'scrypt$%');
