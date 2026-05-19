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
  ('f3a4d6ab-743f-4e0c-a968-3c35b8fc6e93', 'ZF-003', 'Harvest Moon Fields', 32.75, TRUE),
  ('f4a4d6ab-743f-4e0c-a968-3c35b8fc6e94', 'ZF-004', 'Blue Ridge Farm', 50.00, TRUE),
  ('f5a4d6ab-743f-4e0c-a968-3c35b8fc6e95', 'ZF-005', 'Red Hill Farm', 60.00, TRUE),
  ('f6a4d6ab-743f-4e0c-a968-3c35b8fc6e96', 'ZF-006', 'Golden Plains', 70.00, TRUE),
  ('f7a4d6ab-743f-4e0c-a968-3c35b8fc6e97', 'ZF-007', 'Silver Creek', 55.00, TRUE),
  ('f8a4d6ab-743f-4e0c-a968-3c35b8fc6e98', 'ZF-008', 'Maple Grove', 48.00, TRUE),
  ('f9a4d6ab-743f-4e0c-a968-3c35b8fc6e99', 'ZF-009', 'Oak Valley', 65.00, TRUE),
  ('f10a4d6ab-743f-4e0c-a968-3c35b8fc6e100', 'ZF-010', 'Pine Ridge', 58.00, TRUE),
  ('f11a4d6ab-743f-4e0c-a968-3c35b8fc6e101', 'ZF-011', 'Cedar Springs', 62.00, TRUE),
  ('f12a4d6ab-743f-4e0c-a968-3c35b8fc6e102', 'ZF-012', 'Willow Woods', 53.00, TRUE),
  ('f13a4d6ab-743f-4e0c-a968-3c35b8fc6e103', 'ZF-013', 'Elm Fields', 47.00, TRUE),
  ('f14a4d6ab-743f-4e0c-a968-3c35b8fc6e104', 'ZF-014', 'Birch Meadow', 59.00, TRUE),
  ('f15a4d6ab-743f-4e0c-a968-3c35b8fc6e105', 'ZF-015', 'Hawthorn Hill', 71.00, TRUE)
ON CONFLICT (farm_code) DO NOTHING;

-- 5. Map Employees to Farms (Memberships)
-- 3. Map Employees to Farms (Memberships) – each employee gets its own three farms
INSERT INTO farm_memberships (employee_id, farm_id, role) VALUES
  -- Employee 1 gets ZF-001, ZF-002, ZF-003
  ('e1a4d6ab-743f-4e0c-a968-3c35b8fc6e23', 'f1a4d6ab-743f-4e0c-a968-3c35b8fc6e91', 'Manager'),
  ('e1a4d6ab-743f-4e0c-a968-3c35b8fc6e23', 'f2a4d6ab-743f-4e0c-a968-3c35b8fc6e92', 'Manager'),
  ('e1a4d6ab-743f-4e0c-a968-3c35b8fc6e23', 'f3a4d6ab-743f-4e0c-a968-3c35b8fc6e93', 'Manager'),
  -- Employee 2 gets ZF-004, ZF-005, ZF-006
  ('e2a4d6ab-743f-4e0c-a968-3c35b8fc6e24', 'f4a4d6ab-743f-4e0c-a968-3c35b8fc6e94', 'Owner'),
  ('e2a4d6ab-743f-4e0c-a968-3c35b8fc6e24', 'f5a4d6ab-743f-4e0c-a968-3c35b8fc6e95', 'Owner'),
  ('e2a4d6ab-743f-4e0c-a968-3c35b8fc6e24', 'f6a4d6ab-743f-4e0c-a968-3c35b8fc6e96', 'Owner'),
  -- Employee 3 gets ZF-007, ZF-008, ZF-009
  ('e3a4d6ab-743f-4e0c-a968-3c35b8fc6e25', 'f7a4d6ab-743f-4e0c-a968-3c35b8fc6e97', 'Supervisor'),
  ('e3a4d6ab-743f-4e0c-a968-3c35b8fc6e25', 'f8a4d6ab-743f-4e0c-a968-3c35b8fc6e98', 'Supervisor'),
  ('e3a4d6ab-743f-4e0c-a968-3c35b8fc6e25', 'f9a4d6ab-743f-4e0c-a968-3c35b8fc6e99', 'Supervisor'),
  -- Employee 4 gets ZF-010, ZF-011, ZF-012
  ('e4a4d6ab-743f-4e0c-a968-3c35b8fc6e26', 'f10a4d6ab-743f-4e0c-a968-3c35b8fc6e100', 'Operator'),
  ('e4a4d6ab-743f-4e0c-a968-3c35b8fc6e26', 'f11a4d6ab-743f-4e0c-a968-3c35b8fc6e101', 'Operator'),
  ('e4a4d6ab-743f-4e0c-a968-3c35b8fc6e26', 'f12a4d6ab-743f-4e0c-a968-3c35b8fc6e102', 'Operator'),
  -- Employee 5 gets ZF-013, ZF-014, ZF-015
  ('e5a4d6ab-743f-4e0c-a968-3c35b8fc6e27', 'f13a4d6ab-743f-4e0c-a968-3c35b8fc6e103', 'Technician'),
  ('e5a4d6ab-743f-4e0c-a968-3c35b8fc6e27', 'f14a4d6ab-743f-4e0c-a968-3c35b8fc6e104', 'Technician'),
  ('e5a4d6ab-743f-4e0c-a968-3c35b8fc6e27', 'f15a4d6ab-743f-4e0c-a968-3c35b8fc6e105', 'Technician')
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
