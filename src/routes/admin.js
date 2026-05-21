const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const config = require('../config');

const router = express.Router();

const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false },
  db: { schema: 'public' },
});

const JWT_SECRET = process.env.JWT_SECRET || 'zetta-super-secret-key-for-admin-panel';
const authAttempts = new Map(); // Track failed attempts per user token

// Middleware for JWT Auth
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// -------------------------------------------------------------
// LOGIN
// -------------------------------------------------------------
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    const token = jwt.sign({ username: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// -------------------------------------------------------------
// VERIFY PASSWORD (SAVE-GATE)
// -------------------------------------------------------------
router.post('/verify-password', adminAuth, (req, res) => {
  const { password } = req.body;
  const username = req.user.username;
  
  const attempts = authAttempts.get(username) || 0;
  
  if (attempts >= 3) {
    return res.status(403).json({ valid: false, locked: true, error: 'Too many attempts. Changes discarded.' });
  }

  if (password === 'admin123') {
    authAttempts.set(username, 0); // reset on success
    return res.json({ valid: true });
  } else {
    const newAttempts = attempts + 1;
    authAttempts.set(username, newAttempts);
    if (newAttempts >= 3) {
       return res.status(403).json({ valid: false, locked: true, error: 'Too many attempts. Changes discarded.' });
    }
    return res.status(401).json({ valid: false, error: 'Invalid password' });
  }
});

router.use(adminAuth);

// -------------------------------------------------------------
// FARMS
// -------------------------------------------------------------
router.get('/farms', async (req, res) => {
  const { data, error } = await supabase.from('farms').select(`
    *,
    farm_memberships (
      id,
      employees ( employee_id, employee_name, employee_code )
    )
  `).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  
  // Flatten employee info
  const formattedData = data.map(farm => {
    const membership = farm.farm_memberships && farm.farm_memberships.length > 0 ? farm.farm_memberships[0] : null;
    return {
      ...farm,
      employee_id: membership?.employees?.employee_id || null,
      employee_name: membership?.employees?.employee_name || null,
      employee_code: membership?.employees?.employee_code || null,
    };
  });
  
  res.json(formattedData);
});

router.get('/farms/unassigned', async (req, res) => {
  // Get all farms, then filter those without memberships
  const { data, error } = await supabase.from('farms').select(`
    *,
    farm_memberships (id)
  `).eq('active', true).order('farm_name');
  
  if (error) return res.status(500).json({ error: error.message });
  
  const unassignedFarms = data.filter(farm => !farm.farm_memberships || farm.farm_memberships.length === 0);
  res.json(unassignedFarms);
});

router.post('/farms', async (req, res) => {
  const { farm_code, farm_name, total_acres } = req.body;
  const { data, error } = await supabase.from('farms').insert({ farm_code, farm_name, total_acres }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/farms/:id', async (req, res) => {
  const { id } = req.params;
  const { farm_name, total_acres, active } = req.body;
  const { data, error } = await supabase.from('farms').update({ farm_name, total_acres, active }).eq('farm_id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// -------------------------------------------------------------
// PLOTS
// -------------------------------------------------------------
router.get('/farms/:farmId/plots', async (req, res) => {
  const { farmId } = req.params;
  
  // First fetch the plots
  const { data: plotsData, error: plotsError } = await supabase.from('farm_plots').select(`
    *,
    crops (crop_name)
  `).eq('farm_id', farmId);
  
  if (plotsError) return res.status(500).json({ error: plotsError.message });
  
  // Then fetch the farm membership to get the assigned employee
  const { data: farmData, error: farmError } = await supabase.from('farms').select(`
    farm_memberships (
      employees ( employee_name )
    )
  `).eq('farm_id', farmId).single();
  
  if (farmError && farmError.code !== 'PGRST116') { // Ignore not found error here if any
    console.error('Error fetching farm ownership for plots:', farmError);
  }
  
  const assignedEmployee = farmData?.farm_memberships?.[0]?.employees?.employee_name || null;
  
  const formattedData = plotsData.map(plot => ({
    ...plot,
    assigned_employee: assignedEmployee
  }));

  res.json(formattedData);
});

router.post('/farms/:farmId/plots', async (req, res) => {
  const { farmId } = req.params;
  const { plot_code, acres } = req.body;
  const { data, error } = await supabase.from('farm_plots').insert({ farm_id: farmId, plot_code, acres }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/plots/:id', async (req, res) => {
  const { id } = req.params;
  
  // Plot wise locking: if current_crop_id is NOT NULL, prevent update of acres/code
  const { data: existingPlot, error: fetchErr } = await supabase.from('farm_plots').select('current_crop_id').eq('plot_id', id).single();
  
  if (fetchErr || !existingPlot) {
    return res.status(404).json({ error: 'Plot not found' });
  }

  if (existingPlot.current_crop_id !== null) {
    return res.status(403).json({ error: 'Plot is currently active with a crop and cannot be modified until harvested.' });
  }

  const { plot_code, acres, active } = req.body;
  const { data, error } = await supabase.from('farm_plots').update({ plot_code, acres, active }).eq('plot_id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// -------------------------------------------------------------
// CROPS
// -------------------------------------------------------------
router.get('/crops', async (req, res) => {
  const { data, error } = await supabase.from('crops').select('*').order('crop_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/crops', async (req, res) => {
  const { crop_name } = req.body;
  const { data, error } = await supabase.from('crops').insert({ crop_name }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// -------------------------------------------------------------
// EMPLOYEES
// -------------------------------------------------------------
router.get('/employees', async (req, res) => {
  const { data, error } = await supabase.from('employees').select('*').order('employee_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/employees', async (req, res) => {
  const { employee_code, employee_name } = req.body;
  const { data, error } = await supabase.from('employees').insert({ employee_code, employee_name }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/employees/:id', async (req, res) => {
  const { id } = req.params;
  const { employee_code, employee_name, active } = req.body;
  const { data, error } = await supabase.from('employees').update({ employee_code, employee_name, active }).eq('employee_id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// -------------------------------------------------------------
// FARM MEMBERSHIPS
// -------------------------------------------------------------
router.get('/employees/:id/farms', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('farm_memberships').select(`
    id,
    role,
    farms ( farm_id, farm_code, farm_name )
  `).eq('employee_id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/farm-memberships', async (req, res) => {
  const { employee_id, farm_id, role } = req.body;
  const { data, error } = await supabase.from('farm_memberships').insert({ employee_id, farm_id, role: role || 'Member' }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.delete('/farm-memberships/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('farm_memberships').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// -------------------------------------------------------------
// HARVEST REQUESTS
// -------------------------------------------------------------
router.get('/harvest-requests', async (req, res) => {
  const { data, error } = await supabase.from('harvest_requests').select(`
    *,
    farm_plots ( plot_code, farms (farm_name) ),
    crops ( crop_name )
  `).eq('status', 'PENDING').order('requested_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/harvest-requests/:id/approve', async (req, res) => {
  const { id } = req.params;
  
  // 1. Get the request
  const { data: request, error: reqErr } = await supabase.from('harvest_requests').select('*').eq('request_id', id).single();
  if (reqErr || !request) return res.status(404).json({ error: 'Request not found' });
  
  if (request.status !== 'PENDING') {
    return res.status(400).json({ error: 'Request is already processed' });
  }

  // 2. Clear plot's current crop
  const { error: plotErr } = await supabase.from('farm_plots').update({ current_crop_id: null }).eq('plot_id', request.plot_id);
  if (plotErr) return res.status(500).json({ error: plotErr.message });

  // 3. Mark request as APPROVED
  const { data, error: updErr } = await supabase.from('harvest_requests').update({ status: 'APPROVED' }).eq('request_id', id).select().single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  res.json(data);
});

router.post('/harvest-requests/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('harvest_requests').update({ status: 'REJECTED' }).eq('request_id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
