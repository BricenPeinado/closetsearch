CREATE TABLE user_email_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(length(email) BETWEEN 3 AND 320),
  CHECK(length(normalized_email) BETWEEN 3 AND 320),
  CHECK(normalized_email = lower(trim(normalized_email))),
  CHECK(instr(normalized_email, '@') > 1),
  CHECK(verified_at IS NULL OR verified_at >= created_at),
  CHECK(updated_at >= created_at),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX user_email_identities_verified_idx
  ON user_email_identities(verified_at, updated_at DESC);

CREATE TABLE account_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email_identity_id TEXT,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  invalidated_at TEXT,
  invalidation_reason TEXT,
  CHECK(purpose IN ('email_verification', 'password_reset', 'account_export')),
  CHECK(length(token_hash) = 64),
  CHECK(expires_at > created_at),
  CHECK(consumed_at IS NULL OR consumed_at >= created_at),
  CHECK(invalidated_at IS NULL OR invalidated_at >= created_at),
  CHECK(
    (invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR
    (invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL)
  ),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(email_identity_id)
    REFERENCES user_email_identities(id)
    ON DELETE CASCADE
);

CREATE INDEX account_tokens_user_purpose_idx
  ON account_tokens(user_id, purpose, created_at DESC);

CREATE INDEX account_tokens_expiry_idx
  ON account_tokens(expires_at)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;
