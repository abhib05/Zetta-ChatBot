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
  // Ensure we assign the date if empty
  payload.date = payload.date || new Date().toISOString().split('T')[0];

  const { data, error } = await supabase.rpc('submit_full_dts', { payload });

  if (error) {
    console.error('Supabase RPC transaction error:', error);
    throw new Error(`Failed to save DTS transactionally: ${error.message}`);
  }

  console.log(`✅ DTS saved: ${data.id} | Farm: ${payload.farmCode} | Date: ${payload.date}`);
  return data;
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
    .limit(1)
    .maybeSingle();
  return data || null;
}

module.exports = { validateFarmCode, saveDTSSubmission, checkDuplicateSubmission };
