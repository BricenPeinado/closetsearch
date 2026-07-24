CREATE TABLE users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  CHECK (char_length(btrim(username)) BETWEEN 1 AND 80),
  CHECK (
    normalized_username = lower(btrim(normalized_username))
    AND char_length(normalized_username) BETWEEN 1 AND 80
  ),
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE TABLE user_identities (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  normalized_email TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_subject),
  CHECK (identity_type IN ('email', 'oauth', 'admin')),
  CHECK (char_length(btrim(provider)) BETWEEN 1 AND 64),
  CHECK (char_length(btrim(provider_subject)) BETWEEN 1 AND 320),
  CHECK (
    normalized_email IS NULL
    OR (
      normalized_email = lower(btrim(normalized_email))
      AND normalized_email ~ '^[^@]+@[^@]+$'
    )
  ),
  CHECK (verified_at IS NULL OR verified_at >= created_at)
);

CREATE UNIQUE INDEX user_identities_verified_email_unique_idx
  ON user_identities(normalized_email)
  WHERE normalized_email IS NOT NULL AND verified_at IS NOT NULL;

CREATE INDEX user_identities_user_idx
  ON user_identities(user_id, identity_type, created_at DESC);

CREATE TABLE account_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_id UUID REFERENCES user_identities(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  CHECK (purpose IN ('email_verification', 'password_reset', 'account_export')),
  CHECK (char_length(token_hash) BETWEEN 32 AND 256),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)
);

CREATE INDEX account_tokens_active_idx
  ON account_tokens(user_id, purpose, expires_at)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_hint_hash TEXT,
  CHECK (char_length(session_token_hash) BETWEEN 32 AND 256),
  CHECK (expires_at > created_at),
  CHECK (last_seen_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (ip_hint_hash IS NULL OR char_length(ip_hint_hash) BETWEEN 32 AND 256)
);

CREATE INDEX auth_sessions_user_expiry_idx
  ON auth_sessions(user_id, expires_at DESC);

CREATE INDEX auth_sessions_active_idx
  ON auth_sessions(session_token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  preferred_currency TEXT NOT NULL DEFAULT 'USD',
  default_sort_mode TEXT,
  preferred_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 120),
  CHECK (preferred_currency ~ '^[A-Z]{3}$'),
  CHECK (jsonb_typeof(preferred_sources) = 'array'),
  CHECK (jsonb_typeof(onboarding_preferences) = 'object')
);
