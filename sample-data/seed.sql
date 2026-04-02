-- ============================================================
-- ZETTA FARMS — SAMPLE FARM CODES (5 farms)
-- Run AFTER schema/supabase.sql
-- ============================================================

INSERT INTO farms (farm_code, farm_name, location, owner_name, total_acres, active)
VALUES
  (
    'ZF-001',
    'Sunrise Agro Farm',
    'Nashik, Maharashtra',
    'Rajesh Patil',
    45.50,
    TRUE
  ),
  (
    'ZF-002',
    'Green Valley Estate',
    'Pune, Maharashtra',
    'Suresh Kumar',
    78.00,
    TRUE
  ),
  (
    'ZF-003',
    'Harvest Moon Fields',
    'Nagpur, Maharashtra',
    'Priya Desai',
    32.75,
    TRUE
  ),
  (
    'ZF-004',
    'Golden Acres Farm',
    'Aurangabad, Maharashtra',
    'Mohan Singh',
    120.00,
    TRUE
  ),
  (
    'ZF-005',
    'River Bend Organics',
    'Kolhapur, Maharashtra',
    'Anita Jadhav',
    55.25,
    TRUE
  )
ON CONFLICT (farm_code) DO NOTHING;

-- ============================================================
-- VERIFY
-- ============================================================
SELECT farm_code, farm_name, owner_name, total_acres FROM farms ORDER BY farm_code;
