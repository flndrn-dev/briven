-- Postgres init script — runs once on first boot of the `postgres`
-- (control-plane) container.
--
-- Post ADR-0002 (converge-on-doltgres): the control plane is stock
-- Postgres and holds ONLY meta-state — users, orgs, projects, billing,
-- secrets, auth. Customer data lives in the DoltGres data plane as one
-- DATABASE per project, created on demand by the api. So there is no
-- `briven_data` database to create here any more — the data plane is a
-- separate engine (the `doltgres` service), not a second DB in this
-- cluster.
--
-- The `briven_control` database itself is created by the image from
-- POSTGRES_DB; this script only enables the extensions drizzle expects.
-- The pgvector image pre-loads the vector lib; CREATE EXTENSION just
-- enables it for this database.

\c briven_control
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
