-- The runtime receives EXECUTE on this fixed capability, never Identity DML.
-- All application objects are qualified; temporary objects cannot shadow them.
CREATE OR REPLACE FUNCTION identity.writer_command(
  p_session_token text, p_action text, p_target_account_id text, p_payload jsonb,
  p_operation_id text, p_fingerprint text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $writer_command$
DECLARE
  v_actor_user text; v_actor_account text; v_target_user text; v_target_account text;
  v_email text; v_lock_user text; v_session auth.staff_sessions%ROWTYPE;
  v_actor_status text; v_actor_revision integer; v_actor_mfa boolean; v_roles text[];
  v_receipt identity.writer_operation_receipts%ROWTYPE; v_expected integer; v_revision integer;
  v_result jsonb; v_link jsonb; v_changed integer; v_new_role boolean := false;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('create_writer','attach_writer','publish_own','profile','avatar')
    OR p_operation_id IS NULL OR p_operation_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR p_session_token IS NULL OR length(p_session_token) > 1024
  THEN RAISE EXCEPTION USING MESSAGE='WRITER_VALIDATION_ERROR'; END IF;

  SELECT s.user_id,a.id INTO v_actor_user,v_actor_account
    FROM auth.staff_sessions s JOIN identity.accounts a ON a.auth_user_id=s.user_id
    WHERE s.token=p_session_token AND s.expires_at>clock_timestamp();
  IF v_actor_user IS NULL THEN RAISE EXCEPTION USING MESSAGE='WRITER_UNAUTHORIZED'; END IF;
  -- Serializes the receipt even when parallel requests name different targets.
  PERFORM pg_advisory_xact_lock(910230209,hashtext(p_operation_id));
  SELECT * INTO v_receipt FROM identity.writer_operation_receipts WHERE operation_id=p_operation_id;
  IF FOUND AND (v_receipt.actor_account_id<>v_actor_account OR v_receipt.action<>p_action OR v_receipt.fingerprint<>p_fingerprint
    OR (p_target_account_id IS NOT NULL AND v_receipt.target_account_id<>p_target_account_id))
  THEN RAISE EXCEPTION USING MESSAGE='WRITER_OPERATION_CONFLICT'; END IF;

  IF p_action='create_writer' THEN
    IF p_payload - ARRAY['email','passwordHash'] <> '{}'::jsonb OR jsonb_typeof(p_payload->'email') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload->'passwordHash') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION USING MESSAGE='WRITER_VALIDATION_ERROR'; END IF;
    v_email:=p_payload->>'email';
    IF length(v_email)>254 OR v_email<>lower(btrim(v_email)) OR v_email !~ '^[^[:space:]"@]+@[^[:space:]"@]+$'
      -- Better Auth 1.7.10 / @better-auth/utils 0.5.0: 16-byte salt,
      -- 64-byte scrypt key, both lowercase hex (password.node.mjs).
      OR (p_payload->>'passwordHash') !~ '^[0-9a-f]{32}:[0-9a-f]{128}$'
    THEN RAISE EXCEPTION USING MESSAGE='WRITER_VALIDATION_ERROR'; END IF;
    PERFORM pg_advisory_xact_lock(910230208,hashtext(v_email));
    SELECT u.id,a.id INTO v_target_user,v_target_account FROM auth.users u LEFT JOIN identity.accounts a ON a.auth_user_id=u.id WHERE u.email=v_email;
  ELSE
    v_target_account:=p_target_account_id;
    SELECT a.auth_user_id,u.email INTO v_target_user,v_email FROM identity.accounts a JOIN auth.users u ON u.id=a.auth_user_id WHERE a.id=v_target_account;
    IF v_target_user IS NULL THEN RAISE EXCEPTION USING MESSAGE='WRITER_NOT_FOUND'; END IF;
    -- Same email-before-user order as the existing operator.
    PERFORM pg_advisory_xact_lock(910230208,hashtext(v_email));
  END IF;
  FOR v_lock_user IN SELECT DISTINCT u FROM unnest(ARRAY[v_actor_user,v_target_user]) u WHERE u IS NOT NULL ORDER BY u
  LOOP PERFORM pg_advisory_xact_lock(910230207,hashtext(v_lock_user)); END LOOP;

  -- Never authorize using the pre-lock read or caller-supplied actor fields.
  SELECT * INTO v_session FROM auth.staff_sessions WHERE token=p_session_token AND user_id=v_actor_user AND expires_at>clock_timestamp();
  SELECT a.status,u.security_revision,(u.two_factor_enabled AND coalesce(t.verified,false)),
    coalesce(array_agg(r.role_id) FILTER(WHERE r.role_id IS NOT NULL),'{}')
    INTO v_actor_status,v_actor_revision,v_actor_mfa,v_roles
    FROM identity.accounts a JOIN auth.users u ON u.id=a.auth_user_id
    LEFT JOIN auth.two_factors t ON t.user_id=u.id LEFT JOIN identity.account_roles r ON r.account_id=a.id
    WHERE a.id=v_actor_account GROUP BY a.status,u.security_revision,u.two_factor_enabled,t.verified;
  IF v_session.id IS NULL OR v_actor_status IS DISTINCT FROM 'active' OR v_session.security_revision<>v_actor_revision
  THEN RAISE EXCEPTION USING MESSAGE='WRITER_UNAUTHORIZED'; END IF;
  IF NOT(v_roles && ARRAY['writer','admin','super_admin'])
    OR ('super_admin'=ANY(v_roles) AND (NOT v_actor_mfa OR v_session.mfa_verified_at IS NULL))
  THEN RAISE EXCEPTION USING MESSAGE='WRITER_FORBIDDEN'; END IF;
  IF p_action IN ('create_writer','attach_writer','publish_own') THEN
    IF NOT('super_admin'=ANY(v_roles)) THEN RAISE EXCEPTION USING MESSAGE='WRITER_FORBIDDEN'; END IF;
    IF p_target_account_id=v_actor_account THEN RAISE EXCEPTION USING MESSAGE='WRITER_FORBIDDEN'; END IF;
  ELSIF p_target_account_id IS DISTINCT FROM v_actor_account OR NOT('writer'=ANY(v_roles))
  THEN RAISE EXCEPTION USING MESSAGE='WRITER_FORBIDDEN'; END IF;
  IF v_receipt.operation_id IS NOT NULL THEN RETURN v_receipt.result; END IF;

  IF p_action='create_writer' THEN
    -- Existing credentials/identity are deliberately never upserted by Web.
    IF v_target_user IS NOT NULL THEN RAISE EXCEPTION USING MESSAGE='WRITER_ACCOUNT_EXISTS'; END IF;
    v_target_user:=gen_random_uuid()::text; v_target_account:=gen_random_uuid()::text;
    INSERT INTO auth.users(id,email,name) VALUES(v_target_user,v_email,'Staff');
    INSERT INTO identity.accounts(id,auth_user_id) VALUES(v_target_account,v_target_user);
    INSERT INTO identity.account_roles(account_id,role_id) VALUES(v_target_account,'writer');
    INSERT INTO auth.credential_accounts(id,user_id,account_id,provider_id,password)
      VALUES(gen_random_uuid()::text,v_target_user,v_target_user,'credential',p_payload->>'passwordHash');
    INSERT INTO identity.writer_profiles(account_id) VALUES(v_target_account);
    v_revision:=1;
  ELSIF p_action='attach_writer' THEN
    IF p_payload<>'{}'::jsonb THEN RAISE EXCEPTION USING MESSAGE='WRITER_VALIDATION_ERROR'; END IF;
    IF NOT EXISTS(SELECT 1 FROM identity.accounts WHERE id=v_target_account AND status='active')
      OR NOT EXISTS(SELECT 1 FROM auth.credential_accounts WHERE user_id=v_target_user AND provider_id='credential' AND password IS NOT NULL)
    THEN RAISE EXCEPTION USING MESSAGE='WRITER_FORBIDDEN'; END IF;
    INSERT INTO identity.account_roles(account_id,role_id) VALUES(v_target_account,'writer') ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_changed=ROW_COUNT; v_new_role:=v_changed=1;
    INSERT INTO identity.writer_profiles(account_id) VALUES(v_target_account) ON CONFLICT DO NOTHING;
    IF v_new_role THEN
      UPDATE auth.users SET security_revision=security_revision+1,updated_at=clock_timestamp() WHERE id=v_target_user;
      DELETE FROM auth.staff_sessions WHERE user_id=v_target_user;
      DELETE FROM auth.staff_verifications WHERE value=v_target_user OR identifier=v_email;
    END IF;
    SELECT revision INTO v_revision FROM identity.writer_profiles WHERE account_id=v_target_account;
  ELSE
    IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number'
      OR p_payload->>'expectedRevision' !~ '^[0-9]{1,10}$'
      OR (p_payload->>'expectedRevision')::numeric>=2147483647
    THEN RAISE EXCEPTION USING MESSAGE='WRITER_VALIDATION_ERROR'; END IF;
    v_expected:=(p_payload->>'expectedRevision')::integer;
    IF p_action='publish_own' THEN
      IF p_payload-ARRAY['enabled','expectedRevision']<>'{}'::jsonb OR jsonb_typeof(p_payload->'enabled') IS DISTINCT FROM 'boolean'
        OR NOT EXISTS(SELECT 1 FROM identity.account_roles WHERE account_id=v_target_account AND role_id='writer')
      THEN RAISE EXCEPTION USING MESSAGE='WRITER_VALIDATION_ERROR'; END IF;
      IF (p_payload->>'enabled')::boolean AND NOT EXISTS(SELECT 1 FROM identity.accounts WHERE id=v_target_account AND status='active')
      THEN RAISE EXCEPTION USING MESSAGE='WRITER_FORBIDDEN'; END IF;
      SELECT revision INTO v_revision FROM identity.account_permission_assignments WHERE account_id=v_target_account AND permission_id='article.publish.own' FOR UPDATE;
      IF coalesce(v_revision,0)<>v_expected THEN RAISE EXCEPTION USING MESSAGE='WRITER_CONFLICT'; END IF;
      INSERT INTO identity.account_permission_assignments(account_id,permission_id,granted,revision,changed_by_account_id)
        VALUES(v_target_account,'article.publish.own',(p_payload->>'enabled')::boolean,1,v_actor_account)
        ON CONFLICT(account_id,permission_id) DO UPDATE SET granted=excluded.granted,
          revision=identity.account_permission_assignments.revision+1,changed_by_account_id=v_actor_account,updated_at=clock_timestamp()
        RETURNING revision INTO v_revision;
    ELSE
      SELECT revision INTO v_revision FROM identity.writer_profiles WHERE account_id=v_target_account FOR UPDATE;
      IF coalesce(v_revision,0)<>v_expected THEN RAISE EXCEPTION USING MESSAGE='WRITER_CONFLICT'; END IF;
      IF p_action='profile' THEN
        IF p_payload-ARRAY['nickname','socialLinks','expectedRevision']<>'{}'::jsonb
          OR jsonb_typeof(p_payload->'nickname') IS DISTINCT FROM 'string'
          OR length(btrim(p_payload->>'nickname')) NOT BETWEEN 1 AND 60
          OR p_payload->>'nickname'<>btrim(p_payload->>'nickname') OR p_payload->>'nickname' ~ '[[:cntrl:]]'
          OR jsonb_typeof(p_payload->'socialLinks') IS DISTINCT FROM 'array'
        THEN RAISE EXCEPTION USING MESSAGE='WRITER_VALIDATION_ERROR'; END IF;
        IF jsonb_array_length(p_payload->'socialLinks')>10 THEN RAISE EXCEPTION USING MESSAGE='WRITER_VALIDATION_ERROR'; END IF;
        FOR v_link IN SELECT value FROM jsonb_array_elements(p_payload->'socialLinks') LOOP
          IF jsonb_typeof(v_link)<>'object' OR v_link-ARRAY['label','url']<>'{}'::jsonb
            OR jsonb_typeof(v_link->'label') IS DISTINCT FROM 'string' OR length(btrim(v_link->>'label')) NOT BETWEEN 1 AND 60
            OR v_link->>'label' ~ '[[:cntrl:]]' OR jsonb_typeof(v_link->'url') IS DISTINCT FROM 'string'
            OR length(v_link->>'url') NOT BETWEEN 1 AND 2048 OR v_link->>'url' !~ '^https?://[^/?#[:space:]]+'
            OR v_link->>'url' ~ '^https?://[^/?#]*@' OR v_link->>'url' ~ '[[:cntrl:]]'
          THEN RAISE EXCEPTION USING MESSAGE='WRITER_VALIDATION_ERROR'; END IF;
        END LOOP;
        INSERT INTO identity.writer_profiles(account_id,nickname,social_links) VALUES(v_target_account,p_payload->>'nickname',p_payload->'socialLinks')
          ON CONFLICT(account_id) DO UPDATE SET nickname=excluded.nickname,social_links=excluded.social_links,
            revision=identity.writer_profiles.revision+1,updated_at=clock_timestamp() RETURNING revision INTO v_revision;
      ELSE
        IF p_payload-ARRAY['mediaId','expectedRevision']<>'{}'::jsonb OR jsonb_typeof(p_payload->'mediaId') IS DISTINCT FROM 'string'
          OR NOT EXISTS(SELECT 1 FROM media.assets WHERE id=p_payload->>'mediaId' AND uploader_account_id=v_actor_account)
        THEN RAISE EXCEPTION USING MESSAGE='WRITER_FORBIDDEN'; END IF;
        INSERT INTO identity.writer_profiles(account_id,avatar_media_id) VALUES(v_target_account,p_payload->>'mediaId')
          ON CONFLICT(account_id) DO UPDATE SET avatar_media_id=excluded.avatar_media_id,
            revision=identity.writer_profiles.revision+1,updated_at=clock_timestamp() RETURNING revision INTO v_revision;
      END IF;
    END IF;
  END IF;
  v_result:=jsonb_build_object('accountId',v_target_account,'revision',v_revision);
  INSERT INTO identity.writer_operation_receipts(operation_id,actor_account_id,target_account_id,action,fingerprint,result)
    VALUES(p_operation_id,v_actor_account,v_target_account,p_action,p_fingerprint,v_result);
  INSERT INTO auth.security_audit(id,operation_id,event_type,operator,target_account_id,details)
    VALUES(gen_random_uuid()::text,p_operation_id,'writer_command_applied','account:'||v_actor_account,v_target_account,
      jsonb_build_object('action',p_action,'revision',v_revision,'outcome','applied'));
  RETURN v_result;
END
$writer_command$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity.writer_command(text,text,text,jsonb,text,text) FROM PUBLIC;
