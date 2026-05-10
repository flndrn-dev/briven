-- Postgres init script — runs once on first boot of the postgres container.
-- Identical to the dokploy template; coolify reads from this same path.

CREATE DATABASE briven_data;
\c briven_data
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

\c briven_control
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
