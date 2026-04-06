-- ============================================================
-- Migration: Cache + Usage Logs
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Unique constraint on chargers_cache for upsert
ALTER TABLE chargers_cache
  ADD CONSTRAINT chargers_cache_city_state_unique UNIQUE (city, state);

-- 2. Usage logs table
CREATE TABLE IF NOT EXISTS usage_logs (
  id              serial PRIMARY KEY,
  user_id         uuid REFERENCES auth.users,
  module          text NOT NULL,
  city            text,
  claude_tokens_in  int DEFAULT 0,
  claude_tokens_out int DEFAULT 0,
  claude_cost_usd   decimal DEFAULT 0,
  google_places_queries int DEFAULT 0,
  google_places_cost_usd decimal DEFAULT 0,
  total_cost_usd  decimal DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE usage_logs DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_module ON usage_logs (module);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs (created_at);
