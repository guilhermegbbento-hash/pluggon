-- ============================================================
-- Pluggon — Supabase Schema
-- ============================================================

-- 1. city_analyses
CREATE TABLE IF NOT EXISTS city_analyses (
  id            serial PRIMARY KEY,
  user_id       uuid REFERENCES auth.users NOT NULL,
  city          text NOT NULL,
  state         text NOT NULL,
  population    int,
  gdp_per_capita decimal,
  idhm          decimal,
  total_vehicles int,
  ev_count      int,
  charger_count int,
  dc_charger_count int,
  points_json   jsonb,
  status        text DEFAULT 'done',
  created_at    timestamptz DEFAULT now()
);

-- 2. point_scores
CREATE TABLE IF NOT EXISTS point_scores (
  id                 serial PRIMARY KEY,
  user_id            uuid REFERENCES auth.users NOT NULL,
  city_analysis_id   int REFERENCES city_analyses,
  address            text,
  lat                decimal,
  lng                decimal,
  city               text,
  state              text,
  establishment_type text,
  establishment_name text,
  overall_score      decimal,
  classification     text,
  variables_json     jsonb,
  strengths          text[],
  weaknesses         text[],
  recommendation     text,
  status             text DEFAULT 'done',
  created_at         timestamptz DEFAULT now()
);

-- 3. business_plans
CREATE TABLE IF NOT EXISTS business_plans (
  id                serial PRIMARY KEY,
  user_id           uuid REFERENCES auth.users NOT NULL,
  point_score_id    int REFERENCES point_scores,
  client_name       text,
  client_email      text,
  client_phone      text,
  city              text,
  state             text,
  capital_available text,
  objective         text,
  strategy          text,
  challenges        text,
  priorities        text,
  content_json      jsonb,
  pdf_url           text,
  status            text DEFAULT 'done',
  created_at        timestamptz DEFAULT now()
);

-- 4. chargers_cache
CREATE TABLE IF NOT EXISTS chargers_cache (
  id              serial PRIMARY KEY,
  city            text NOT NULL,
  state           text NOT NULL,
  total_stations  int,
  public_stations int,
  dc_fast         int,
  stations_json   jsonb,
  fetched_at      timestamptz DEFAULT now()
);

-- ============================================================
-- Disable RLS on all tables
-- ============================================================
ALTER TABLE city_analyses   DISABLE ROW LEVEL SECURITY;
ALTER TABLE point_scores    DISABLE ROW LEVEL SECURITY;
ALTER TABLE business_plans  DISABLE ROW LEVEL SECURITY;
ALTER TABLE chargers_cache  DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_city_analyses_user_id ON city_analyses (user_id);
CREATE INDEX IF NOT EXISTS idx_city_analyses_city    ON city_analyses (city);

CREATE INDEX IF NOT EXISTS idx_point_scores_user_id ON point_scores (user_id);
CREATE INDEX IF NOT EXISTS idx_point_scores_city    ON point_scores (city);

CREATE INDEX IF NOT EXISTS idx_business_plans_user_id ON business_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_business_plans_city    ON business_plans (city);

CREATE INDEX IF NOT EXISTS idx_chargers_cache_city ON chargers_cache (city);
