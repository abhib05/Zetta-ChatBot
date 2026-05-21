const sessionService = require('../../services/session');
const whatsappService = require('../../services/whatsapp');
const supabaseService = require('../../services/supabase');
const { ACTIVITY_TYPES } = require('./constants');

async function submitToDB(from, session) {
  // Defensive: Ensure activities array exists
  if (!session.parsedJSON.activities) {
    session.parsedJSON.activities = [];
  }

  // Map Names to UUIDs and enforce numeric types before DB insertion
  const cleanActivities = session.parsedJSON.activities.map(act => {
    // 1. Map Plot
    if (act.plot_name) {
      const p = session.dbCache.plots.find(x => x.plot_code.toLowerCase() === act.plot_name.toLowerCase());
      if (p) act.plot_id = p.plot_id;
    }
    // 2. Map Crop
    if (act.crop_name) {
      const c = session.dbCache.allCrops.find(x => x.crop_name.toLowerCase() === act.crop_name.toLowerCase());
      if (c) act.crop_id = c.crop_id;
    }
    // 3. Map Machine — guard `act.details` existence to prevent TypeError when LLM omits the details object
    if (act.details && act.details.machine_name) {
      const m = session.dbCache.machines.find(x => x.machine_name.toLowerCase() === act.details.machine_name.toLowerCase());
      if (m) {
        act.details.machine_id = m.machine_id;
        act.details.machine_code_snapshot = m.machine_code;
      }
    }

    // Copy generic fields to details if they are expected by the database details tables
    if (act.details) {
      if (act.labour_count !== undefined && act.labour_count !== null && act.details.labour_count === undefined) {
        act.details.labour_count = act.labour_count;
      }
      if (act.duration_minutes !== undefined && act.duration_minutes !== null && act.details.time_minutes === undefined) {
        act.details.time_minutes = act.duration_minutes;
      }
      if (act.expense_amount !== undefined && act.expense_amount !== null && act.details.expense_amount === undefined) {
        act.details.expense_amount = act.expense_amount;
      }
    }

    // 4. Defensively enforce numeric fields (LLM sometimes fails to nullify text in integers)
    const intFields = ['labour_count', 'duration_minutes', 'harvest_cycle_no', 'plants_sown', 'time_minutes', 'machine_time_minutes'];
    const numFields = ['acres', 'expense_amount', 'quantity', 'fuel_used_litres', 'input_qty', 'seed_rate_per_acre'];

    intFields.forEach(f => {
      if (act[f] !== undefined) act[f] = parseInt(act[f]) || null;
      if (act.details && act.details[f] !== undefined) act.details[f] = parseInt(act.details[f]) || null;
    });
    numFields.forEach(f => {
      if (act[f] !== undefined) act[f] = parseFloat(act[f]) || null;
      if (act.details && act.details[f] !== undefined) act.details[f] = parseFloat(act.details[f]) || null;
    });

    // 5. Defensively enforce ENUM fields
    if (act.details && act.details.power_source) {
      const validPowerSources = ['solar', 'electricity', 'generator'];
      const ps = act.details.power_source.toLowerCase();
      if (!validPowerSources.includes(ps)) {
        act.details.power_source = null;
      } else {
        act.details.power_source = ps;
      }
    }
    return act;
  });

  const payload = {
    farm_id: session.farmId,
    farm_code_snapshot: session.farmCode,
    farm_name_snapshot: session.farmName,
    report_date: new Date().toISOString().split('T')[0],
    filled_by_employee_id: session.employeeId,
    deviation_notes: session.parsedJSON.deviation_notes,
    next_day_plans: session.parsedJSON.next_day_plans,
    agronomy_report: session.parsedJSON.agronomy_report,
    activities: cleanActivities
  };

  try {
    // Guard: prevent duplicate DTS submissions for the same farm+day
    const today = new Date().toISOString().split('T')[0];
    const existing = await supabaseService.checkDuplicateSubmission(session.farmId, today);
    if (existing) {
      await whatsappService.sendMessage(from, `⚠️ A DTS for *${session.farmCode}* on *${today}* was already submitted (Ref: ${existing.submission_id}). Resetting session.`);
      await sessionService.deleteSession(from);
      return;
    }

    const saved = await supabaseService.saveDTSSubmission(payload);
    await whatsappService.sendMessage(from, `✅ Daily Task Sheet Submitted successfully!\nReference ID: ${saved.submission_id}\n\nHave a good evening!`);
    await sessionService.deleteSession(from);
  } catch (err) {
    console.error('Save Error:', err);
    await whatsappService.sendMessage(from, `Failed to save to database. Error: ${err.message}`);
  }
}

module.exports = { submitToDB };
