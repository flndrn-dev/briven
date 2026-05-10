-- Postgres init script — runs once on first boot of the postgres container.
-- Creates the data-plane database alongside the default `briven_control`.
-- The pgvector extension is pre-loaded by the `pgvector/pgvector:pg17`
-- image; we just CREATE EXTENSION here in case it isn't enabled per-db.

CREATE DATABASE briven_data;
\c briven_data
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

\c briven_control
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
