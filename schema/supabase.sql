-- ============================================================
-- DTS / Farm Management Schema
-- PostgreSQL
-- ============================================================

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- MASTER TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS employees (
  employee_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS farms (
  farm_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_code TEXT UNIQUE NOT NULL,
  farm_name TEXT,
  total_acres NUMERIC CHECK (total_acres >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crops (
  crop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_name TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS farm_plots (
  plot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
  plot_code TEXT NOT NULL,
  acres NUMERIC CHECK (acres > 0),
  current_crop_id UUID REFERENCES crops(crop_id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (farm_id, plot_code)
);

CREATE TABLE IF NOT EXISTS activity_types (
  activity_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS machines (
  machine_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_code TEXT UNIQUE NOT NULL,
  machine_name TEXT NOT NULL,
  machine_type TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS farm_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  farm_id UUID NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  UNIQUE (employee_id, farm_id)
);

-- ============================================================
-- DTS HEADER / SUBMISSION
-- ============================================================

CREATE TABLE IF NOT EXISTS dts_submissions (
  submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
  farm_name_snapshot TEXT,
  farm_code_snapshot TEXT,
  report_date DATE NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_by_employee_id UUID REFERENCES employees(employee_id) ON DELETE SET NULL,
  deviation_notes TEXT,
  next_day_plans TEXT,
  agronomy_report TEXT,
  UNIQUE (farm_id, report_date)
);

-- ============================================================
-- MONITORING
-- ============================================================

CREATE TABLE IF NOT EXISTS dts_monitoring_readings (
  reading_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES dts_submissions(submission_id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period IN ('morning', 'evening')),
  observation_time TIME NOT NULL,
  temperature_c NUMERIC,
  humidity_pct NUMERIC CHECK (humidity_pct BETWEEN 0 AND 100),
  rainfall_mm NUMERIC CHECK (rainfall_mm >= 0),
  UNIQUE (submission_id, period)
);

-- ============================================================
-- COMMON ACTIVITY HEADER
-- One row per activity entry on the DTS
-- ============================================================

CREATE TABLE IF NOT EXISTS dts_activity_entries (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES dts_submissions(submission_id) ON DELETE CASCADE,
  activity_type_id UUID NOT NULL REFERENCES activity_types(activity_type_id),
  plot_id UUID REFERENCES farm_plots(plot_id) ON DELETE SET NULL,
  crop_id UUID REFERENCES crops(crop_id) ON DELETE SET NULL,
  acres NUMERIC CHECK (acres >= 0),
  labour_count INT CHECK (labour_count >= 0),
  duration_minutes INT CHECK (duration_minutes >= 0),
  expense_amount NUMERIC CHECK (expense_amount >= 0),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dts_activity_entries_submission_id
  ON dts_activity_entries(submission_id);

CREATE INDEX IF NOT EXISTS idx_dts_activity_entries_activity_type_id
  ON dts_activity_entries(activity_type_id);

CREATE INDEX IF NOT EXISTS idx_dts_activity_entries_plot_id
  ON dts_activity_entries(plot_id);

CREATE INDEX IF NOT EXISTS idx_dts_activity_entries_crop_id
  ON dts_activity_entries(crop_id);

-- ============================================================
-- ACTIVITY-SPECIFIC DETAIL TABLES
-- Each entry_id should appear once in the relevant detail table
-- ============================================================

CREATE TABLE IF NOT EXISTS dts_land_preparation_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL UNIQUE REFERENCES dts_activity_entries(entry_id) ON DELETE CASCADE,
  activity_name TEXT NOT NULL,
  machine_id UUID REFERENCES machines(machine_id) ON DELETE SET NULL,
  time_minutes INT CHECK (time_minutes >= 0),
  expense_amount NUMERIC CHECK (expense_amount >= 0)
);

CREATE TABLE IF NOT EXISTS dts_sowing_transplanting_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL UNIQUE REFERENCES dts_activity_entries(entry_id) ON DELETE CASCADE,
  seed_rate_per_acre NUMERIC CHECK (seed_rate_per_acre >= 0),
  plants_sown INT CHECK (plants_sown >= 0),
  sowing_method TEXT NOT NULL,
  labour_count INT CHECK (labour_count >= 0),
  machine_time_minutes INT CHECK (machine_time_minutes >= 0),
  expense_amount NUMERIC CHECK (expense_amount >= 0)
);

CREATE TABLE IF NOT EXISTS dts_irrigation_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL UNIQUE REFERENCES dts_activity_entries(entry_id) ON DELETE CASCADE,
  irrigation_method TEXT NOT NULL,
  power_source TEXT CHECK (power_source IN ('solar', 'electricity', 'generator')),
  labour_count INT CHECK (labour_count >= 0),
  time_minutes INT CHECK (time_minutes >= 0),
  fuel_used_litres NUMERIC CHECK (fuel_used_litres >= 0),
  expense_amount NUMERIC CHECK (expense_amount >= 0)
);

CREATE TABLE IF NOT EXISTS dts_weeding_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL UNIQUE REFERENCES dts_activity_entries(entry_id) ON DELETE CASCADE,
  weeding_method TEXT NOT NULL,
  labour_count INT CHECK (labour_count >= 0),
  input_name TEXT,
  input_qty NUMERIC CHECK (input_qty >= 0),
  time_minutes INT CHECK (time_minutes >= 0),
  expense_amount NUMERIC CHECK (expense_amount >= 0)
);

CREATE TABLE IF NOT EXISTS dts_agri_input_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL UNIQUE REFERENCES dts_activity_entries(entry_id) ON DELETE CASCADE,
  input_method TEXT NOT NULL,
  input_type TEXT NOT NULL,
  input_name TEXT NOT NULL,
  input_qty NUMERIC CHECK (input_qty >= 0),
  labour_count INT CHECK (labour_count >= 0),
  time_minutes INT CHECK (time_minutes >= 0),
  expense_amount NUMERIC CHECK (expense_amount >= 0)
);

CREATE TABLE IF NOT EXISTS dts_other_machinery_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL UNIQUE REFERENCES dts_activity_entries(entry_id) ON DELETE CASCADE,
  machine_id UUID REFERENCES machines(machine_id) ON DELETE SET NULL,
  machine_code_snapshot TEXT,
  time_minutes INT CHECK (time_minutes >= 0),
  fuel_used_litres NUMERIC CHECK (fuel_used_litres >= 0)
);

CREATE TABLE IF NOT EXISTS dts_harvest_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL UNIQUE REFERENCES dts_activity_entries(entry_id) ON DELETE CASCADE,
  harvest_cycle_no INT CHECK (harvest_cycle_no > 0),
  harvesting_method TEXT NOT NULL,
  quantity NUMERIC CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  labour_count INT CHECK (labour_count >= 0),
  machine_time_minutes INT CHECK (machine_time_minutes >= 0),
  expense_amount NUMERIC CHECK (expense_amount >= 0)
);

-- ============================================================
-- OPTIONAL QUALITY CHECKS
-- ============================================================

ALTER TABLE farm_plots
  ADD CONSTRAINT chk_farm_plots_acres_positive
  CHECK (acres IS NULL OR acres > 0);

ALTER TABLE dts_submissions
  ADD CONSTRAINT chk_report_date_not_future
  CHECK (report_date <= CURRENT_DATE);

ALTER TABLE dts_activity_entries
  ADD CONSTRAINT chk_activity_acres_nonnegative
  CHECK (acres IS NULL OR acres >= 0);

-- ============================================================
-- OPTIONAL SEED DATA FOR ACTIVITY TYPES
-- ============================================================

INSERT INTO activity_types (name) VALUES
  ('land_preparation'),
  ('sowing_transplanting'),
  ('irrigation'),
  ('weeding'),
  ('agri_inputs'),
  ('other_machinery_usage'),
  ('harvest')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- RPC FUNCTION FOR SUBMISSIONS
-- ============================================================
CREATE OR REPLACE FUNCTION submit_full_dts(payload jsonb) RETURNS json AS $$
DECLARE
  v_submission_id UUID;
  v_entry_id UUID;
  v_activity_type_id UUID;
  item jsonb;
BEGIN
  -- 1. Insert main DTS record
  INSERT INTO dts_submissions (
    farm_id, 
    farm_code_snapshot, 
    farm_name_snapshot, 
    report_date, 
    filled_by_employee_id, 
    deviation_notes, 
    next_day_plans, 
    agronomy_report
  )
  VALUES (
    (payload->>'farm_id')::UUID, 
    payload->>'farm_code_snapshot', 
    payload->>'farm_name_snapshot', 
    (payload->>'report_date')::DATE, 
    NULLIF((payload->>'filled_by_employee_id'), '')::UUID,
    payload->>'deviation_notes', 
    payload->>'next_day_plans', 
    payload->>'agronomy_report'
  )
  ON CONFLICT (farm_id, report_date) DO UPDATE SET
    deviation_notes = EXCLUDED.deviation_notes,
    next_day_plans = EXCLUDED.next_day_plans,
    agronomy_report = EXCLUDED.agronomy_report,
    submitted_at = now()
  RETURNING submission_id INTO v_submission_id;

  -- 2. Insert activities
  IF jsonb_typeof(payload->'activities') = 'array' THEN
    FOR item IN SELECT * FROM jsonb_array_elements(payload->'activities')
    LOOP
      -- Get activity_type_id based on name
      SELECT activity_type_id INTO v_activity_type_id 
      FROM activity_types 
      WHERE name = item->>'activity_type_name';

      -- Insert into generic activity entries
      INSERT INTO dts_activity_entries (
        submission_id, 
        activity_type_id, 
        plot_id, 
        crop_id, 
        acres, 
        labour_count, 
        duration_minutes, 
        expense_amount, 
        remarks
      )
      VALUES (
        v_submission_id, 
        v_activity_type_id, 
        NULLIF((item->>'plot_id'), '')::UUID, 
        NULLIF((item->>'crop_id'), '')::UUID, 
        NULLIF((item->>'acres'), '')::numeric, 
        NULLIF((item->>'labour_count'), '')::int, 
        NULLIF((item->>'duration_minutes'), '')::int, 
        NULLIF((item->>'expense_amount'), '')::numeric, 
        item->>'remarks'
      )
      RETURNING entry_id INTO v_entry_id;

      -- Insert into specific detail tables
      IF item->>'activity_type_name' = 'land_preparation' THEN
        INSERT INTO dts_land_preparation_details (entry_id, activity_name, machine_id, time_minutes, expense_amount)
        VALUES (v_entry_id, item->'details'->>'activity_name', NULLIF((item->'details'->>'machine_id'), '')::UUID, NULLIF((item->'details'->>'time_minutes'), '')::int, NULLIF((item->'details'->>'expense_amount'), '')::numeric);

      ELSIF item->>'activity_type_name' = 'sowing_transplanting' THEN
        -- Also update the current crop in farm_plots
        IF item->>'plot_id' IS NOT NULL AND item->>'crop_id' IS NOT NULL THEN
          UPDATE farm_plots SET current_crop_id = (item->>'crop_id')::UUID WHERE plot_id = (item->>'plot_id')::UUID;
        END IF;
        
        INSERT INTO dts_sowing_transplanting_details (entry_id, seed_rate_per_acre, plants_sown, sowing_method, labour_count, machine_time_minutes, expense_amount)
        VALUES (v_entry_id, NULLIF((item->'details'->>'seed_rate_per_acre'), '')::numeric, NULLIF((item->'details'->>'plants_sown'), '')::int, item->'details'->>'sowing_method', NULLIF((item->'details'->>'labour_count'), '')::int, NULLIF((item->'details'->>'machine_time_minutes'), '')::int, NULLIF((item->'details'->>'expense_amount'), '')::numeric);

      ELSIF item->>'activity_type_name' = 'irrigation' THEN
        INSERT INTO dts_irrigation_details (entry_id, irrigation_method, power_source, labour_count, time_minutes, fuel_used_litres, expense_amount)
        VALUES (v_entry_id, item->'details'->>'irrigation_method', item->'details'->>'power_source', NULLIF((item->'details'->>'labour_count'), '')::int, NULLIF((item->'details'->>'time_minutes'), '')::int, NULLIF((item->'details'->>'fuel_used_litres'), '')::numeric, NULLIF((item->'details'->>'expense_amount'), '')::numeric);

      ELSIF item->>'activity_type_name' = 'weeding' THEN
        INSERT INTO dts_weeding_details (entry_id, weeding_method, labour_count, input_name, input_qty, time_minutes, expense_amount)
        VALUES (v_entry_id, item->'details'->>'weeding_method', NULLIF((item->'details'->>'labour_count'), '')::int, item->'details'->>'input_name', NULLIF((item->'details'->>'input_qty'), '')::numeric, NULLIF((item->'details'->>'time_minutes'), '')::int, NULLIF((item->'details'->>'expense_amount'), '')::numeric);

      ELSIF item->>'activity_type_name' = 'agri_inputs' THEN
        INSERT INTO dts_agri_input_details (entry_id, input_method, input_type, input_name, input_qty, labour_count, time_minutes, expense_amount)
        VALUES (v_entry_id, item->'details'->>'input_method', item->'details'->>'input_type', item->'details'->>'input_name', NULLIF((item->'details'->>'input_qty'), '')::numeric, NULLIF((item->'details'->>'labour_count'), '')::int, NULLIF((item->'details'->>'time_minutes'), '')::int, NULLIF((item->'details'->>'expense_amount'), '')::numeric);

      ELSIF item->>'activity_type_name' = 'other_machinery_usage' THEN
        INSERT INTO dts_other_machinery_details (entry_id, machine_id, machine_code_snapshot, time_minutes, fuel_used_litres)
        VALUES (v_entry_id, NULLIF((item->'details'->>'machine_id'), '')::UUID, item->'details'->>'machine_code_snapshot', NULLIF((item->'details'->>'time_minutes'), '')::int, NULLIF((item->'details'->>'fuel_used_litres'), '')::numeric);

      ELSIF item->>'activity_type_name' = 'harvest' THEN
        -- Clear current crop in farm_plots upon harvest
        IF item->>'plot_id' IS NOT NULL THEN
          UPDATE farm_plots SET current_crop_id = NULL WHERE plot_id = (item->>'plot_id')::UUID;
        END IF;

        INSERT INTO dts_harvest_details (entry_id, harvest_cycle_no, harvesting_method, quantity, unit, labour_count, machine_time_minutes, expense_amount)
        VALUES (v_entry_id, NULLIF((item->'details'->>'harvest_cycle_no'), '')::int, item->'details'->>'harvesting_method', NULLIF((item->'details'->>'quantity'), '')::numeric, item->'details'->>'unit', NULLIF((item->'details'->>'labour_count'), '')::int, NULLIF((item->'details'->>'machine_time_minutes'), '')::int, NULLIF((item->'details'->>'expense_amount'), '')::numeric);
      END IF;
    END LOOP;
  END IF;

  RETURN json_build_object('submission_id', v_submission_id);
END;
$$ LANGUAGE plpgsql;