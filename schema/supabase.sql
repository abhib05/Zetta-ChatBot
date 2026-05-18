-- ============================================================
-- ZETTA FARMS — SUPABASE DATABASE SCHEMA
-- Run this entire script in Supabase SQL Editor (one shot)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- TABLE 1: farms
-- Master list of farms and their codes.
-- ============================================================
CREATE TABLE IF NOT EXISTS farms (
  farm_code    VARCHAR(20)  PRIMARY KEY,
  location     VARCHAR(255),
  owner_name   VARCHAR(255),
  total_acres  DECIMAL(10,2),
  active       BOOLEAN      DEFAULT TRUE,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE farms IS 'Master registry of all Zetta farm properties and their unique codes';
COMMENT ON COLUMN farms.farm_code IS 'Unique alphanumeric code used by farmers to identify their farm (e.g. ZF-001)';
COMMENT ON COLUMN farms.active    IS 'Set to false to deactivate a farm without deleting records';


-- ============================================================
-- TABLE 2: dts_submissions
-- One record per farm per day — the master DTS entry.
-- ============================================================
CREATE TABLE IF NOT EXISTS dts_submissions (
  id                    UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  farm_code             VARCHAR(20) NOT NULL REFERENCES farms(farm_code) ON UPDATE CASCADE,
  submission_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  filled_by             VARCHAR(255),
  reasons_for_deviation TEXT,
  next_day_plans        TEXT,
  agronomy_report       TEXT,
  whatsapp_number       VARCHAR(30),
  conversation_id       VARCHAR(120),
  submitted_at          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE dts_submissions IS 'Daily Task Sheet master record — one per farm per day';
COMMENT ON COLUMN dts_submissions.conversation_id IS 'Internal ID linking to the WhatsApp conversation session for audit trail';


-- ============================================================
-- TABLE 3: machinery_usage
-- Each row = one machine activity entry on the DTS.
-- ============================================================
CREATE TABLE IF NOT EXISTS machinery_usage (
  id                  UUID         DEFAULT uuid_generate_v4() PRIMARY KEY,
  dts_submission_id   UUID         NOT NULL REFERENCES dts_submissions(id) ON DELETE CASCADE,
  plot                VARCHAR(100),
  crop                VARCHAR(150),
  acres               DECIMAL(10,2),
  activity_name       VARCHAR(255),
  machine_type        VARCHAR(100),
  time_minutes        INTEGER      DEFAULT 0 CHECK (time_minutes >= 0 AND time_minutes < 60),
  fuel_used_litres    DECIMAL(10,2),
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE machinery_usage IS 'Individual machinery/equipment activity rows from the DTS Machinery Usage section';


-- ============================================================
-- TABLE 4: harvest_records
-- Each row = one harvest entry on the DTS.
-- ============================================================
CREATE TABLE IF NOT EXISTS harvest_records (
  id                  UUID         DEFAULT uuid_generate_v4() PRIMARY KEY,
  dts_submission_id   UUID         NOT NULL REFERENCES dts_submissions(id) ON DELETE CASCADE,
  plot                VARCHAR(100),
  crop                VARCHAR(150),
  acres               DECIMAL(10,2),
  harvest_cycle_no    VARCHAR(20),
  harvesting_method   VARCHAR(100),
  quantity            DECIMAL(12,2),
  quantity_unit       VARCHAR(50)  DEFAULT 'kg',
  labour_count        INTEGER,
  machine             VARCHAR(150),
  time_minutes        INTEGER      DEFAULT 0 CHECK (time_minutes >= 0 AND time_minutes < 60),
  expense_amount      DECIMAL(12,2),
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE harvest_records IS 'Individual harvest activity rows from the DTS Harvest section';


-- ============================================================
-- INDEXES — tuned for 600 submissions/day query patterns
-- ============================================================

-- Fast lookup by farm_code (used for validation + analytics)
CREATE INDEX IF NOT EXISTS idx_farms_code
  ON farms(farm_code);

-- Fast lookup by date (most common query: "show me today's reports")
CREATE INDEX IF NOT EXISTS idx_dts_date
  ON dts_submissions(submission_date DESC);

-- Fast lookup by farm + date (duplicate check on every submission)
CREATE INDEX IF NOT EXISTS idx_dts_farm_date
  ON dts_submissions(farm_code, submission_date);

-- Fast join from child tables back to parent DTS
CREATE INDEX IF NOT EXISTS idx_machinery_dts_id
  ON machinery_usage(dts_submission_id);

CREATE INDEX IF NOT EXISTS idx_harvest_dts_id
  ON harvest_records(dts_submission_id);

-- WhatsApp number lookup (for farmer history)
CREATE INDEX IF NOT EXISTS idx_dts_whatsapp
  ON dts_submissions(whatsapp_number);


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Our Node.js backend uses the service_role key and bypasses RLS.
-- Enable RLS anyway so anon/user keys cannot access raw data.
-- ============================================================

ALTER TABLE farms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dts_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE machinery_usage   ENABLE ROW LEVEL SECURITY;
ALTER TABLE harvest_records   ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (used by our chatbot backend)
CREATE POLICY "service_role_all_farms"
  ON farms FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_dts"
  ON dts_submissions FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_machinery"
  ON machinery_usage FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_harvest"
  ON harvest_records FOR ALL
  USING (auth.role() = 'service_role');


-- ============================================================
-- VIEWS — handy for the admin dashboard / reporting
-- ============================================================

-- Daily summary: one row per DTS with aggregated counts
CREATE OR REPLACE VIEW v_daily_summary AS
SELECT
  d.id                                        AS submission_id,
  d.farm_code,
  f.owner_name,
  f.location,
  d.submission_date,
  d.filled_by,
  d.submitted_at,
  d.reasons_for_deviation,
  d.next_day_plans,
  d.agronomy_report,
  COUNT(DISTINCT m.id)                        AS machinery_entries,
  COALESCE(SUM(m.fuel_used_litres), 0)        AS total_fuel_litres,
  COUNT(DISTINCT h.id)                        AS harvest_entries,
  COALESCE(SUM(h.quantity), 0)                AS total_harvest_qty,
  MIN(h.quantity_unit)                        AS harvest_unit
FROM dts_submissions d
JOIN farms f ON f.farm_code = d.farm_code
LEFT JOIN machinery_usage m ON m.dts_submission_id = d.id
LEFT JOIN harvest_records h ON h.dts_submission_id = d.id
GROUP BY
  d.id, d.farm_code, f.owner_name, f.location,
  d.submission_date, d.filled_by, d.submitted_at,
  d.reasons_for_deviation, d.next_day_plans, d.agronomy_report;

COMMENT ON VIEW v_daily_summary IS 'Aggregated daily view — use for dashboard and reporting';


-- Farms that have NOT submitted today (for follow-up alerts)
CREATE OR REPLACE VIEW v_missing_submissions_today AS
SELECT
  f.farm_code,
  f.owner_name,
  f.location
FROM farms f
WHERE f.active = TRUE
  AND f.farm_code NOT IN (
    SELECT farm_code
    FROM dts_submissions
    WHERE submission_date = CURRENT_DATE
  );

COMMENT ON VIEW v_missing_submissions_today IS 'Farms that have not yet submitted their DTS today';


-- ============================================================
-- AUTO-UPDATE updated_at trigger on farms
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_farms_updated_at
  BEFORE UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RPC FUNCTION — transactions
-- ============================================================
CREATE OR REPLACE FUNCTION submit_full_dts(payload jsonb) RETURNS json AS $$
DECLARE
  v_dts_id UUID;
  item jsonb;
BEGIN
  -- 1. Insert main DTS record
  INSERT INTO dts_submissions (
    farm_code, submission_date, filled_by, 
    reasons_for_deviation, next_day_plans, agronomy_report, 
    whatsapp_number, conversation_id
  )
  VALUES (
    payload->>'farmCode', 
    (payload->>'date')::date, 
    payload->>'filledBy',
    payload->>'reasonsForDeviation', 
    payload->>'nextDayPlans', 
    payload->>'agronomyReport',
    payload->>'whatsappNumber', 
    payload->>'conversationId'
  )
  RETURNING id INTO v_dts_id;

  -- 2. Insert machinery_usage
  IF jsonb_typeof(payload->'machineryUsage') = 'array' THEN
    FOR item IN SELECT * FROM jsonb_array_elements(payload->'machineryUsage')
    LOOP
      INSERT INTO machinery_usage (
        dts_submission_id, plot, crop, acres, activity_name, 
        machine_type, machine_code, time_hours, time_minutes, fuel_used_litres
      )
      VALUES (
        v_dts_id, 
        item->>'plot', 
        item->>'crop', 
        NULLIF((item->>'acres'), '')::numeric, 
        item->>'activityName', 
        item->>'machineType', 
        item->>'machineCode', 
        COALESCE(NULLIF((item->>'timeHours'), '')::int, 0), 
        COALESCE(NULLIF((item->>'timeMinutes'), '')::int, 0), 
        NULLIF((item->>'fuelUsed'), '')::numeric
      );
    END LOOP;
  END IF;

  -- 3. Insert harvest_records
  IF jsonb_typeof(payload->'harvest') = 'array' THEN
    FOR item IN SELECT * FROM jsonb_array_elements(payload->'harvest')
    LOOP
      INSERT INTO harvest_records (
        dts_submission_id, plot, crop, acres, harvest_cycle_no, harvesting_method, 
        quantity, quantity_unit, labour_count, machine, time_hours, time_minutes, 
        expense_type, expense_amount
      )
      VALUES (
        v_dts_id, 
        item->>'plot', 
        item->>'crop', 
        NULLIF((item->>'acres'), '')::numeric, 
        item->>'harvestCycleNo', 
        item->>'harvestingMethod', 
        NULLIF((item->>'quantity'), '')::numeric, 
        COALESCE(item->>'quantityUnit', 'kg'), 
        NULLIF((item->>'labourCount'), '')::int, 
        item->>'machine', 
        COALESCE(NULLIF((item->>'timeHours'), '')::int, 0), 
        COALESCE(NULLIF((item->>'timeMinutes'), '')::int, 0), 
        item->>'expenseType', 
        NULLIF((item->>'expenseAmount'), '')::numeric
      );
    END LOOP;
  END IF;

  RETURN json_build_object('id', v_dts_id);
END;
$$ LANGUAGE plpgsql;
