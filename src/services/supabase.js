/**
 * Supabase Service
 * All database reads/writes go through this file.
 * Uses the Service Role key — bypasses RLS for backend operations.
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false },
  db: { schema: 'public' },
  global: {
    headers: { 'x-application-name': 'zetta-farm-chatbot' },
  },
});

// ─────────────────────────────────────────────
// FARM VALIDATION
// ─────────────────────────────────────────────

/**
 * Check if a farm code exists and is active.
 * Returns farm info or null.
 */
async function validateFarmCode(farmCode) {
  const { data, error } = await supabase
    .from('farms')
    .select('farm_code, farm_name, owner_name, location, total_acres')
    .eq('farm_code', farmCode.trim().toUpperCase())
    .eq('active', true)
    .single();

  if (error || !data) return null;
  return data;
}

// ─────────────────────────────────────────────
// DTS SUBMISSION
// ─────────────────────────────────────────────

/**
 * Save a complete DTS submission with all related records.
 * Uses Supabase's transaction-like sequential inserts.
 *
 * @param {Object} payload
 * @returns {Object} saved dts_submission record
 */
async function saveDTSSubmission(payload) {
  const {
    farmCode,
    date,
    filledBy,
    reasonsForDeviation,
    nextDayPlans,
    agronomyReport,
    machineryUsage = [],
    harvest = [],
    whatsappNumber,
    conversationId,
  } = payload;

  // ── 1. Insert main DTS record ──────────────────────────────────
  const { data: dts, error: dtsError } = await supabase
    .from('dts_submissions')
    .insert({
      farm_code: farmCode,
      submission_date: date || new Date().toISOString().split('T')[0],
      filled_by: filledBy || null,
      reasons_for_deviation: reasonsForDeviation || null,
      next_day_plans: nextDayPlans || null,
      agronomy_report: agronomyReport || null,
      whatsapp_number: whatsappNumber,
      conversation_id: conversationId,
    })
    .select()
    .single();

  if (dtsError) {
    console.error('Supabase DTS insert error:', dtsError);
    throw new Error(`Failed to save DTS: ${dtsError.message}`);
  }

  const dtsId = dts.id;

  // ── 2. Insert machinery usage records ─────────────────────────
  if (machineryUsage.length > 0) {
    const machineryRows = machineryUsage.map((m) => ({
      dts_submission_id: dtsId,
      plot: m.plot || null,
      crop: m.crop || null,
      acres: m.acres ? parseFloat(m.acres) : null,
      activity_name: m.activityName || null,
      machine_type: m.machineType || null,
      machine_code: m.machineCode || null,
      time_hours: m.timeHours ? parseInt(m.timeHours) : 0,
      time_minutes: m.timeMinutes ? parseInt(m.timeMinutes) : 0,
      fuel_used_litres: m.fuelUsed ? parseFloat(m.fuelUsed) : null,
    }));

    const { error: machErr } = await supabase
      .from('machinery_usage')
      .insert(machineryRows);

    if (machErr) {
      console.error('Machinery insert error:', machErr);
      throw new Error(`Failed to save machinery data: ${machErr.message}`);
    }
  }

  // ── 3. Insert harvest records ──────────────────────────────────
  if (harvest.length > 0) {
    const harvestRows = harvest.map((h) => ({
      dts_submission_id: dtsId,
      plot: h.plot || null,
      crop: h.crop || null,
      acres: h.acres ? parseFloat(h.acres) : null,
      harvest_cycle_no: h.harvestCycleNo || null,
      harvesting_method: h.harvestingMethod || null,
      quantity: h.quantity ? parseFloat(h.quantity) : null,
      quantity_unit: h.quantityUnit || 'kg',
      labour_count: h.labourCount ? parseInt(h.labourCount) : null,
      machine: h.machine || null,
      time_hours: h.timeHours ? parseInt(h.timeHours) : 0,
      time_minutes: h.timeMinutes ? parseInt(h.timeMinutes) : 0,
      expense_type: h.expenseType || null,
      expense_amount: h.expenseAmount ? parseFloat(h.expenseAmount) : null,
    }));

    const { error: harvErr } = await supabase
      .from('harvest_records')
      .insert(harvestRows);

    if (harvErr) {
      console.error('Harvest insert error:', harvErr);
      throw new Error(`Failed to save harvest data: ${harvErr.message}`);
    }
  }

  console.log(`✅ DTS saved: ${dts.id} | Farm: ${farmCode} | Date: ${date}`);
  return dts;
}

// ─────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────

/**
 * Check if a DTS for a given farm+date already exists.
 */
async function checkDuplicateSubmission(farmCode, date) {
  const { data } = await supabase
    .from('dts_submissions')
    .select('id, submitted_at')
    .eq('farm_code', farmCode)
    .eq('submission_date', date)
    .single();
  return data || null;
}

module.exports = { validateFarmCode, saveDTSSubmission, checkDuplicateSubmission };
