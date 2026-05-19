-- ============================================================
-- ZETTA FARMS — SAMPLE DATA (Normalized)
-- Run AFTER schema/supabase.sql
-- ============================================================

-- 1. Create Employees
-- 1. Create Employees
INSERT INTO employees (employee_id, employee_code, employee_name, active) VALUES
  ('e1a4d6ab-743f-4e0c-a968-3c35b8fc6e23', 'emp 001', 'Rajesh Patil', TRUE),
  ('e2a4d6ab-743f-4e0c-a968-3c35b8fc6e24', 'emp 002', 'Suresh Kumar', TRUE),
  ('e3a4d6ab-743f-4e0c-a968-3c35b8fc6e25', 'emp 003', 'Priya Desai', TRUE),
  ('e4a4d6ab-743f-4e0c-a968-3c35b8fc6e26', 'emp 004', 'Anita Sharma', TRUE),
  ('e5a4d6ab-743f-4e0c-a968-3c35b8fc6e27', 'emp 005', 'Vikram Singh', TRUE)
ON CONFLICT DO NOTHING;


-- 2. Create Crops
INSERT INTO crops (crop_id, crop_name, active) VALUES
  ('c1a4d6ab-743f-4e0c-a968-3c35b8fc6e11', 'Sugarcane', TRUE),
  ('c2a4d6ab-743f-4e0c-a968-3c35b8fc6e12', 'Wheat', TRUE),
  ('c3a4d6ab-743f-4e0c-a968-3c35b8fc6e13', 'Cotton', TRUE)
ON CONFLICT DO NOTHING;

-- 3. Create Machines
INSERT INTO machines (machine_id, machine_code, machine_name, machine_type, active) VALUES
  ('a1a4d6ab-743f-4e0c-a968-3c35b8fc6e01', 'TR-001', 'John Deere 5050D', 'Tractor', TRUE),
  ('a2a4d6ab-743f-4e0c-a968-3c35b8fc6e02', 'HV-001', 'Mahindra Harvester', 'Harvester', TRUE)
ON CONFLICT (machine_code) DO NOTHING;

-- 4. Create Farms
INSERT INTO farms (farm_id, farm_code, farm_name, total_acres, active) VALUES
  ('f1a4d6ab-743f-4e0c-a968-3c35b8fc6e91', 'ZF-001', 'Sunrise Agro Farm', 45.50, TRUE),
  ('f2a4d6ab-743f-4e0c-a968-3c35b8fc6e92', 'ZF-002', 'Green Valley Estate', 78.00, TRUE),
  ('f3a4d6ab-743f-4e0c-a968-3c35b8fc6e93', 'ZF-003', 'Harvest Moon Fields', 32.75, TRUE)
ON CONFLICT (farm_code) DO NOTHING;

-- 5. Map Employees to Farms (Memberships)
-- 3. Map Employees to Farms (Memberships) – each employee gets all three farms
INSERT INTO farm_memberships (employee_id, farm_id, role) VALUES
  -- Employee 1
  ('e1a4d6ab-743f-4e0c-a968-3c35b8fc6e23', 'f1a4d6ab-743f-4e0c-a968-3c35b8fc6e91', 'Manager'),
  ('e1a4d6ab-743f-4e0c-a968-3c35b8fc6e23', 'f2a4d6ab-743f-4e0c-a968-3c35b8fc6e92', 'Manager'),
  ('e1a4d6ab-743f-4e0c-a968-3c35b8fc6e23', 'f3a4d6ab-743f-4e0c-a968-3c35b8fc6e93', 'Manager'),
  -- Employee 2
  ('e2a4d6ab-743f-4e0c-a968-3c35b8fc6e24', 'f1a4d6ab-743f-4e0c-a968-3c35b8fc6e91', 'Owner'),
  ('e2a4d6ab-743f-4e0c-a968-3c35b8fc6e24', 'f2a4d6ab-743f-4e0c-a968-3c35b8fc6e92', 'Owner'),
  ('e2a4d6ab-743f-4e0c-a968-3c35b8fc6e24', 'f3a4d6ab-743f-4e0c-a968-3c35b8fc6e93', 'Owner'),
  -- Employee 3
  ('e3a4d6ab-743f-4e0c-a968-3c35b8fc6e25', 'f1a4d6ab-743f-4e0c-a968-3c35b8fc6e91', 'Supervisor'),
  ('e3a4d6ab-743f-4e0c-a968-3c35b8fc6e25', 'f2a4d6ab-743f-4e0c-a968-3c35b8fc6e92', 'Supervisor'),
  ('e3a4d6ab-743f-4e0c-a968-3c35b8fc6e25', 'f3a4d6ab-743f-4e0c-a968-3c35b8fc6e93', 'Supervisor'),
  -- Employee 4
  ('e4a4d6ab-743f-4e0c-a968-3c35b8fc6e26', 'f1a4d6ab-743f-4e0c-a968-3c35b8fc6e91', 'Operator'),
  ('e4a4d6ab-743f-4e0c-a968-3c35b8fc6e26', 'f2a4d6ab-743f-4e0c-a968-3c35b8fc6e92', 'Operator'),
  ('e4a4d6ab-743f-4e0c-a968-3c35b8fc6e26', 'f3a4d6ab-743f-4e0c-a968-3c35b8fc6e93', 'Operator'),
  -- Employee 5
  ('e5a4d6ab-743f-4e0c-a968-3c35b8fc6e27', 'f1a4d6ab-743f-4e0c-a968-3c35b8fc6e91', 'Technician'),
  ('e5a4d6ab-743f-4e0c-a968-3c35b8fc6e27', 'f2a4d6ab-743f-4e0c-a968-3c35b8fc6e92', 'Technician'),
  ('e5a4d6ab-743f-4e0c-a968-3c35b8fc6e27', 'f3a4d6ab-743f-4e0c-a968-3c35b8fc6e93', 'Technician')
ON CONFLICT DO NOTHING;


-- 6. Create Initial Farm Plots & Set Current Crop
INSERT INTO farm_plots (plot_id, farm_id, plot_code, acres, current_crop_id, active) VALUES
  ('b1a4d6ab-743f-4e0c-a968-3c35b8fc6e81', 'f1a4d6ab-743f-4e0c-a968-3c35b8fc6e91', 'Plot A1', 10.00, 'c1a4d6ab-743f-4e0c-a968-3c35b8fc6e11', TRUE),
  ('b2a4d6ab-743f-4e0c-a968-3c35b8fc6e82', 'f1a4d6ab-743f-4e0c-a968-3c35b8fc6e91', 'Plot B2', 15.50, 'c2a4d6ab-743f-4e0c-a968-3c35b8fc6e12', TRUE)
ON CONFLICT DO NOTHING;

-- ============================================================
-- VERIFY
-- ============================================================
SELECT farm_code, farm_name, total_acres FROM farms ORDER BY farm_code;
