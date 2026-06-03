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
// FARM VALIDATION & METADATA
// ─────────────────────────────────────────────

/**
 * Check if an employee code exists and is active.
 * Returns employee info (including UUID) or null.
 */
async function validateEmployeeCode(employeeCode) {
  const { data, error } = await supabase
    .from('employees')
    .select('employee_id, employee_code, employee_name')
    .ilike('employee_code', employeeCode.trim())
    .eq('active', true)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Check if a farm code exists, is active, and the employee is assigned to it.
 * Returns farm info (including UUID) or null.
 */
async function validateEmployeeFarmAccess(employeeId, farmCode) {
  const { data: farm, error: farmError } = await supabase
    .from('farms')
    .select('farm_id, farm_code, farm_name, total_acres')
    .ilike('farm_code', farmCode.trim())
    .eq('active', true)
    .single();

  if (farmError || !farm) return null;

  // Check if membership exists
  const { data: membership, error: memberError } = await supabase
    .from('farm_memberships')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('farm_id', farm.farm_id)
    .single();

  if (memberError || !membership) return null;

  return farm;
}

/**
 * Check if a farm code exists and is active (legacy fallback if needed).
 * Returns farm info (including UUID) or null.
 */
async function validateFarmCode(farmCode) {
  const { data, error } = await supabase
    .from('farms')
    .select('farm_id, farm_code, farm_name, total_acres')
    .ilike('farm_code', farmCode.trim())
    .eq('active', true)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Get all plots and crops for a given farm UUID.
 * Helps determine if onboarding is needed, and provides lists for fuzzy matching.
 */
async function getFarmDetails(farmId) {
  // Fetch plots with their current crop
  const { data: plots } = await supabase
    .from('farm_plots')
    .select('plot_id, plot_code, current_crop_id, crops(crop_name)')
    .eq('farm_id', farmId)
    .eq('active', true);

  // Fetch all available crops in the system (for fuzzy matching when sowing)
  const { data: allCrops } = await supabase
    .from('crops')
    .select('crop_id, crop_name')
    .eq('active', true);

  // Fetch all available machines
  const { data: machines } = await supabase
    .from('machines')
    .select('machine_id, machine_code, machine_name, machine_type')
    .eq('active', true);

  // Fetch employee list (for 'filled_by' matching)
  const { data: employees } = await supabase
    .from('employees')
    .select('employee_id, employee_name')
    .eq('active', true);

  // Fetch already submitted activities for today
  const today = new Date().toISOString().split('T')[0];
  const { data: submission } = await supabase
    .from('dts_submissions')
    .select('submission_id')
    .eq('farm_id', farmId)
    .eq('report_date', today)
    .limit(1)
    .maybeSingle();

  let submittedToday = [];
  if (submission) {
    const { data: acts } = await supabase
      .from('dts_activity_entries')
      .select('entry_id, plot_id, activity_types(name)')
      .eq('submission_id', submission.submission_id);
      
    if (acts) {
      submittedToday = acts.map(a => ({
        entry_id: a.entry_id,
        plot_id: a.plot_id,
        activity_type_name: a.activity_types?.name
      }));
    }
  }

  return {
    plots: plots || [],
    allCrops: allCrops || [],
    machines: machines || [],
    employees: employees || [],
    submittedToday,
    submission_id: submission ? submission.submission_id : null
  };
}

// ─────────────────────────────────────────────
// ONBOARDING
// ─────────────────────────────────────────────

/**
 * Save new plots and crop associations during onboarding.
 */
async function saveFarmOnboarding(farmId, plotsData) {
  // Expected plotsData: [{ plot_code: 'A1', acres: 5, crop_name: 'Wheat' }, ...]
  for (const plot of plotsData) {
    let cropId = null;
    if (plot.crop_name) {
      // Find or create crop
      const { data: cropData } = await supabase
        .from('crops')
        .select('crop_id')
        .ilike('crop_name', plot.crop_name.trim())
        .maybeSingle();
      
      if (cropData) {
        cropId = cropData.crop_id;
      } else {
        // Insert new crop
        const { data: newCrop } = await supabase
          .from('crops')
          .insert({ crop_name: plot.crop_name.trim() })
          .select('crop_id')
          .single();
        if (newCrop) cropId = newCrop.crop_id;
      }
    }

    // Insert plot
    await supabase.from('farm_plots').insert({
      farm_id: farmId,
      plot_code: plot.plot_code.trim(),
      acres: plot.acres || null,
      current_crop_id: cropId
    });
  }
}

// ─────────────────────────────────────────────
// DTS SUBMISSION
// ─────────────────────────────────────────────

/**
 * Save a complete DTS submission with all related records.
 * Calls the complex `submit_full_dts` RPC.
 */
async function saveDTSSubmission(payload) {
  // Ensure date is set
  payload.report_date = payload.report_date || new Date().toISOString().split('T')[0];

  const { data, error } = await supabase.rpc('submit_full_dts', { payload });

  if (error) {
    console.error('Supabase RPC transaction error:', error);
    throw new Error(`Failed to save DTS transactionally: ${error.message}`);
  }

  return data;
}

/**
 * Check if a DTS for a given farm+date already exists.
 */
async function checkDuplicateSubmission(farmId, date) {
  const { data } = await supabase
    .from('dts_submissions')
    .select('submission_id, submitted_at')
    .eq('farm_id', farmId)
    .eq('report_date', date)
    .limit(1)
    .maybeSingle();
  return data || null;
}

/**
 * Check if specific activities already exist for a farm on a specific date.
 * Returns an array of duplicate activities found.
 */
async function checkDuplicateActivities(farmId, date, activitiesToCheck) {
  const submission = await checkDuplicateSubmission(farmId, date);
  if (!submission) return [];

  const { data } = await supabase
    .from('dts_activity_entries')
    .select('plot_id, activity_types(name)')
    .eq('submission_id', submission.submission_id);

  if (!data || data.length === 0) return [];

  const duplicates = [];
  for (const act of activitiesToCheck) {
    const actName = act.activity_type_name || act.activity; // Might be act.activity depending on pipeline stage
    const existing = data.find(d => 
      d.activity_types && d.activity_types.name === actName && 
      d.plot_id === act.plot_id
    );
    if (existing) {
      duplicates.push(act);
    }
  }

  return duplicates;
}

/**
 * Delete a specific activity entry.
 */
async function deleteActivityEntry(entryId) {
  const { error } = await supabase
    .from('dts_activity_entries')
    .delete()
    .eq('entry_id', entryId);
    
  if (error) {
    console.error('Error deleting activity entry:', error);
    return false;
  }
  return true;
}

/**
 * Retrieve and format an existing DTS submission for user review.
 */
async function getDTSSubmissionSummary(submissionId) {
  const { data: submission, error } = await supabase
    .from('dts_submissions')
    .select(`
      report_date,
      farm_name_snapshot,
      deviation_notes,
      dts_activity_entries (
        activity_types (name, label),
        farm_plots (plot_code),
        crops (crop_name),
        acres,
        labour_count,
        duration_minutes
      )
    `)
    .eq('submission_id', submissionId)
    .maybeSingle();

  if (error || !submission) {
    return "Error: Could not retrieve the previous report.";
  }

  let summary = `📝 *PREVIOUS SUBMITTED REPORT*\n`;
  summary += `----------------------------------------\n`;
  summary += `🌾 *Farm:* ${submission.farm_name_snapshot || 'N/A'}\n`;
  summary += `📅 *Date:* ${submission.report_date}\n`;
  summary += `----------------------------------------\n\n`;

  const activities = submission.dts_activity_entries || [];
  if (activities.length === 0) {
    summary += `*Activities:* None.\n`;
  } else {
    summary += `*Logged Activities (${activities.length}):*\n`;
    activities.forEach((act, idx) => {
      const typeLabel = act.activity_types?.label || act.activity_types?.name?.replace(/_/g, ' ').toUpperCase() || 'ACTIVITY';
      const plotName = act.farm_plots?.plot_code || '-';
      const cropName = act.crops?.crop_name || '-';
      summary += `\n*${idx + 1}. ${typeLabel}*\n`;
      summary += `  • Plot: ${plotName}\n`;
      summary += `  • Crop: ${cropName}\n`;
      if (act.acres != null) summary += `  • Acres: ${act.acres} ac\n`;
      if (act.labour_count != null) summary += `  • Labour: ${act.labour_count}\n`;
      if (act.duration_minutes != null) summary += `  • Duration: ${act.duration_minutes} min\n`;
    });
  }

  if (submission.deviation_notes) {
    summary += `\n----------------------------------------\n`;
    summary += `*Notes:* ${submission.deviation_notes}\n`;
  }
  
  return summary;
}

/**
 * Delete an entire DTS submission and cascade to its entries.
 */
async function deleteDTSSubmission(submissionId) {
  const { error } = await supabase
    .from('dts_submissions')
    .delete()
    .eq('submission_id', submissionId);
    
  if (error) {
    console.error('Error deleting submission:', error);
    throw error;
  }
  return true;
}

/**
 * Find active employee by their WhatsApp phone number.
 * Returns employee info and their assigned farm or null.
 */
async function findEmployeeByPhone(phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[^\d]/g, '');
  if (cleanPhone.length < 10) return null;
  const last10 = cleanPhone.slice(-10);

  const { data: employee, error } = await supabase
    .from('employees')
    .select(`
      employee_id,
      employee_name,
      employee_code,
      active,
      farm_memberships (
        farms (
          farm_id,
          farm_code,
          farm_name
        )
      )
    `)
    .or(`phone_number.eq.${cleanPhone},phone_number.eq.+${cleanPhone},phone_number.like.%${last10}`)
    .eq('active', true)
    .maybeSingle();

  if (error || !employee) return null;

  const farms = employee.farm_memberships
    ? employee.farm_memberships.map(m => m.farms).filter(Boolean)
    : [];

  return {
    employee_id: employee.employee_id,
    employee_name: employee.employee_name,
    employee_code: employee.employee_code,
    farms: farms.map(farm => ({
      farm_id: farm.farm_id,
      farm_code: farm.farm_code,
      farm_name: farm.farm_name
    })),
    farm: farms.length > 0 ? {
      farm_id: farms[0].farm_id,
      farm_code: farms[0].farm_code,
      farm_name: farms[0].farm_name
    } : null
  };
}


async function getDTSSubmission(submissionId) {
  const { data, error } = await supabase
    .from('dts_submissions')
    .select(`
      *,
      dts_activity_entries (
        *,
        activity_types (name),
        farm_plots (plot_code),
        crops (crop_name),
        dts_land_preparation_details (*),
        dts_sowing_transplanting_details (*),
        dts_irrigation_details (*),
        dts_weeding_details (*),
        dts_agri_input_details (*),
        dts_other_machinery_details (*),
        dts_harvest_details (*)
      )
    `)
    .eq('submission_id', submissionId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching full DTS submission:', error);
    throw error;
  }
  return data;
}

module.exports = { 
  validateEmployeeCode,
  validateEmployeeFarmAccess,
  validateFarmCode, 
  getFarmDetails, 
  saveFarmOnboarding, 
  saveDTSSubmission, 
  checkDuplicateSubmission,
  checkDuplicateActivities,
  deleteActivityEntry,
  getDTSSubmissionSummary,
  deleteDTSSubmission,
  findEmployeeByPhone,
  getDTSSubmission
};
