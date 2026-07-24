ALTER TABLE account_tokens
  ADD COLUMN invalidation_reason TEXT;

ALTER TABLE account_tokens
  ADD CONSTRAINT account_tokens_invalidation_reason_length_check
  CHECK (
    (
      invalidated_at IS NULL
      AND invalidation_reason IS NULL
    )
    OR (
      invalidated_at IS NOT NULL
      AND invalidation_reason IS NOT NULL
      AND char_length(btrim(invalidation_reason)) BETWEEN 1 AND 200
    )
  );

CREATE UNIQUE INDEX user_identities_email_user_unique_idx
  ON user_identities(user_id)
  WHERE identity_type = 'email';

CREATE UNIQUE INDEX user_identities_normalized_email_unique_idx
  ON user_identities(normalized_email)
  WHERE identity_type = 'email' AND normalized_email IS NOT NULL;

ALTER TABLE watchlists
  ADD COLUMN brand_text TEXT;

ALTER TABLE watchlists
  ADD CONSTRAINT watchlists_brand_text_length_check
  CHECK (
    brand_text IS NULL
    OR char_length(btrim(brand_text)) BETWEEN 1 AND 200
  );
