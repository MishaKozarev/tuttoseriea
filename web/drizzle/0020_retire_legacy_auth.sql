-- Cutover barrier: never restore legacy authentication capabilities on image rollback.
-- Stop old auth writers/SMTP before deployment. Preserve users, Identity and domain FKs.
WITH retired_sessions AS (
  UPDATE auth.sessions SET expires = now() AT TIME ZONE 'UTC'
  WHERE expires > now() AT TIME ZONE 'UTC' RETURNING 1
), retired_tokens AS (
  UPDATE auth.verification_tokens SET expires = now() AT TIME ZONE 'UTC'
  WHERE expires > now() AT TIME ZONE 'UTC' RETURNING 1
)
INSERT INTO auth.security_audit(id, operation_id, event_type, operator, details)
VALUES ('migration-0020-legacy-retirement', 'migration/0020', 'legacy_retired', current_user,
  jsonb_build_object('sessions', (SELECT count(*) FROM retired_sessions),
    'tokens', (SELECT count(*) FROM retired_tokens), 'outcome', 'retired'))
ON CONFLICT DO NOTHING;
