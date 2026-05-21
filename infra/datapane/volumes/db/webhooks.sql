BEGIN;
  -- Create pg_net extension
  CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
  -- Create briven_functions schema
  CREATE SCHEMA briven_functions AUTHORIZATION briven_admin;
  GRANT USAGE ON SCHEMA briven_functions TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA briven_functions GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA briven_functions GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA briven_functions GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
  -- briven_functions.migrations definition
  CREATE TABLE briven_functions.migrations (
    version text PRIMARY KEY,
    inserted_at timestamptz NOT NULL DEFAULT NOW()
  );
  -- Initial briven_functions migration
  INSERT INTO briven_functions.migrations (version) VALUES ('initial');
  -- briven_functions.hooks definition
  CREATE TABLE briven_functions.hooks (
    id bigserial PRIMARY KEY,
    hook_table_id integer NOT NULL,
    hook_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    request_id bigint
  );
  CREATE INDEX briven_functions_hooks_request_id_idx ON briven_functions.hooks USING btree (request_id);
  CREATE INDEX briven_functions_hooks_h_table_id_h_name_idx ON briven_functions.hooks USING btree (hook_table_id, hook_name);
  COMMENT ON TABLE briven_functions.hooks IS 'Briven Functions Hooks: Audit trail for triggered hooks.';
  CREATE FUNCTION briven_functions.http_request()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    DECLARE
      request_id bigint;
      payload jsonb;
      url text := TG_ARGV[0]::text;
      method text := TG_ARGV[1]::text;
      headers jsonb DEFAULT '{}'::jsonb;
      params jsonb DEFAULT '{}'::jsonb;
      timeout_ms integer DEFAULT 1000;
    BEGIN
      IF url IS NULL OR url = 'null' THEN
        RAISE EXCEPTION 'url argument is missing';
      END IF;

      IF method IS NULL OR method = 'null' THEN
        RAISE EXCEPTION 'method argument is missing';
      END IF;

      IF TG_ARGV[2] IS NULL OR TG_ARGV[2] = 'null' THEN
        headers = '{"Content-Type": "application/json"}'::jsonb;
      ELSE
        headers = TG_ARGV[2]::jsonb;
      END IF;

      IF TG_ARGV[3] IS NULL OR TG_ARGV[3] = 'null' THEN
        params = '{}'::jsonb;
      ELSE
        params = TG_ARGV[3]::jsonb;
      END IF;

      IF TG_ARGV[4] IS NULL OR TG_ARGV[4] = 'null' THEN
        timeout_ms = 1000;
      ELSE
        timeout_ms = TG_ARGV[4]::integer;
      END IF;

      CASE
        WHEN method = 'GET' THEN
          SELECT http_get INTO request_id FROM net.http_get(
            url,
            params,
            headers,
            timeout_ms
          );
        WHEN method = 'POST' THEN
          payload = jsonb_build_object(
            'old_record', OLD,
            'record', NEW,
            'type', TG_OP,
            'table', TG_TABLE_NAME,
            'schema', TG_TABLE_SCHEMA
          );

          SELECT http_post INTO request_id FROM net.http_post(
            url,
            payload,
            params,
            headers,
            timeout_ms
          );
        ELSE
          RAISE EXCEPTION 'method argument % is invalid', method;
      END CASE;

      INSERT INTO briven_functions.hooks
        (hook_table_id, hook_name, request_id)
      VALUES
        (TG_RELID, TG_NAME, request_id);

      RETURN NEW;
    END
  $function$;
  -- Briven super admin
  DO
  $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'briven_functions_admin'
    )
    THEN
      CREATE USER briven_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;
  END
  $$;
  GRANT ALL PRIVILEGES ON SCHEMA briven_functions TO briven_functions_admin;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA briven_functions TO briven_functions_admin;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA briven_functions TO briven_functions_admin;
  ALTER USER briven_functions_admin SET search_path = "briven_functions";
  ALTER table "briven_functions".migrations OWNER TO briven_functions_admin;
  ALTER table "briven_functions".hooks OWNER TO briven_functions_admin;
  ALTER function "briven_functions".http_request() OWNER TO briven_functions_admin;
  GRANT briven_functions_admin TO postgres;
  -- Remove unused briven_pg_net_admin role
  DO
  $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'briven_pg_net_admin'
    )
    THEN
      REASSIGN OWNED BY briven_pg_net_admin TO briven_admin;
      DROP OWNED BY briven_pg_net_admin;
      DROP ROLE briven_pg_net_admin;
    END IF;
  END
  $$;
  -- pg_net grants when extension is already enabled
  DO
  $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'pg_net'
    )
    THEN
      GRANT USAGE ON SCHEMA net TO briven_functions_admin, postgres, anon, authenticated, service_role;
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO briven_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO briven_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END
  $$;
  -- Event trigger for pg_net
  CREATE OR REPLACE FUNCTION extensions.grant_pg_net_access()
  RETURNS event_trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_event_trigger_ddl_commands() AS ev
      JOIN pg_extension AS ext
      ON ev.objid = ext.oid
      WHERE ext.extname = 'pg_net'
    )
    THEN
      GRANT USAGE ON SCHEMA net TO briven_functions_admin, postgres, anon, authenticated, service_role;
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO briven_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO briven_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END;
  $$;
  COMMENT ON FUNCTION extensions.grant_pg_net_access IS 'Grants access to pg_net';
  DO
  $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_event_trigger
      WHERE evtname = 'issue_pg_net_access'
    ) THEN
      CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end WHEN TAG IN ('CREATE EXTENSION')
      EXECUTE PROCEDURE extensions.grant_pg_net_access();
    END IF;
  END
  $$;
  INSERT INTO briven_functions.migrations (version) VALUES ('20210809183423_update_grants');
  ALTER function briven_functions.http_request() SECURITY DEFINER;
  ALTER function briven_functions.http_request() SET search_path = briven_functions;
  REVOKE ALL ON FUNCTION briven_functions.http_request() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION briven_functions.http_request() TO postgres, anon, authenticated, service_role;
COMMIT;
