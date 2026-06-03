/**
 * Tool Handlers Implementation
 * 
 * Implements the logic for all tools called by the LLM orchestrator.
 * Modifies the session state and returns a structured output to the LLM.
 *
 * Required fields per activity type are read exclusively from:
 *   src/config/activitySchema.js  ← single source of truth
 * Do NOT add hardcoded field lists here.
 */

const { ACTIVITY_SCHEMA, getFieldLabel } = require('../config/activitySchema');
const submissionService = require('../handlers/steps/submission');
const openaiService = require('../services/openai');
const supabaseService = require('../services/supabase');

function generateId() {
  return `act_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

/**
 * Add a new activity to the draft DTS state.
 */
function add_draft_activity(session, args) {
  if (!session.draft) {
    session.draft = { activities: [], meta: { deviation_notes: null, next_day_plans: null, agronomy_report: null } };
  }
  if (!session.draft.activities) {
    session.draft.activities = [];
  }

  // Normalize plot_names to array
  let plotNames = [];
  if (Array.isArray(args.plot_names)) {
    plotNames = args.plot_names.map(p => p.trim().toUpperCase());
  } else if (typeof args.plot_names === 'string' && args.plot_names.trim()) {
    plotNames = [args.plot_names.trim().toUpperCase()];
  }

  const newActivity = {
    id: generateId(),
    activity_type_name: args.activity_type_name,
    plot_names: plotNames,
    crop_name: args.crop_name || null,
    acres: args.acres !== undefined ? args.acres : null,
    acres_is_estimate: args.acres_is_estimate === true,
    labour_count: args.labour_count !== undefined ? args.labour_count : null,
    duration_minutes: args.duration_minutes !== undefined ? args.duration_minutes : null,
    expense_amount: args.expense_amount !== undefined ? args.expense_amount : null,
    remarks: args.remarks || null,
    details: args.details || {},
    same_work_confirmed: null,
    _complete: false
  };

  session.draft.activities.push(newActivity);
  return {
    success: true,
    message: `Added activity ${newActivity.activity_type_name} with ID ${newActivity.id}`,
    activity: newActivity
  };
}

/**
 * Update an existing draft activity.
 */
function update_draft_dts(session, args) {
  if (!session.draft || !session.draft.activities) return { success: false, message: 'No draft state active.' };

  const activity = session.draft.activities.find(a => a.id === args.activityId);
  if (!activity) {
    return { success: false, message: `Activity with ID ${args.activityId} not found.` };
  }

  const { fields } = args;

  // If plot_names are updated, normalize them
  if (fields.plot_names !== undefined) {
    let plotNames = [];
    if (Array.isArray(fields.plot_names)) {
      plotNames = fields.plot_names.map(p => p.trim().toUpperCase());
    } else if (typeof fields.plot_names === 'string' && fields.plot_names.trim()) {
      plotNames = [fields.plot_names.trim().toUpperCase()];
    }
    
    if (JSON.stringify(activity.plot_names) !== JSON.stringify(plotNames)) {
      activity.plot_names = plotNames;
      if (plotNames.length > 1) {
        activity.same_work_confirmed = null;
      } else {
        activity.same_work_confirmed = null;
      }
    }
  }

  // Update rest of the fields
  const allowedFields = [
    'activity_type_name', 'crop_name',
    'acres', 'acres_is_estimate',
    'labour_count', 'duration_minutes', 'expense_amount', 'remarks'
  ];
  allowedFields.forEach(f => {
    if (fields[f] !== undefined) {
      activity[f] = fields[f];
    }
  });

  // Update details
  if (fields.details !== undefined && typeof fields.details === 'object') {
    activity.details = {
      ...(activity.details || {}),
      ...fields.details
    };
  }

  return {
    success: true,
    message: `Updated activity ${activity.id}`,
    activity
  };
}

/**
 * Remove an activity from the draft.
 */
function remove_draft_activity(session, args) {
  if (!session.draft || !session.draft.activities) return { success: false, message: 'No draft state active.' };

  const initialLength = session.draft.activities.length;
  session.draft.activities = session.draft.activities.filter(a => a.id !== args.activityId);

  if (session.draft.activities.length < initialLength) {
    return { success: true, message: `Removed activity ${args.activityId}.` };
  } else {
    return { success: false, message: `Activity ${args.activityId} not found.` };
  }
}

/**
 * Clear specific fields from a draft activity.
 */
function clear_draft_fields(session, args) {
  if (!session.draft || !session.draft.activities) return { success: false, message: 'No draft state active.' };

  const activity = session.draft.activities.find(a => a.id === args.activityId);
  if (!activity) {
    return { success: false, message: `Activity ${args.activityId} not found.` };
  }

  const { fields } = args;
  fields.forEach(field => {
    if (field.startsWith('details.')) {
      const detailKey = field.split('.')[1];
      if (activity.details) {
        activity.details[detailKey] = null;
      }
    } else {
      activity[field] = null;
    }
  });

  if (fields.includes('plot_names')) {
    activity.plot_names = [];
    activity.same_work_confirmed = null;
  }

  return {
    success: true,
    message: `Cleared fields [${fields.join(', ')}] on activity ${args.activityId}.`,
    activity
  };
}

/**
 * Update general metadata for the draft (notes, plans, agronomy report).
 */
function update_draft_metadata(session, args) {
  if (!session.draft) {
    session.draft = { activities: [], meta: { deviation_notes: null, next_day_plans: null, agronomy_report: null } };
  }
  if (!session.draft.meta) {
    session.draft.meta = { deviation_notes: null, next_day_plans: null, agronomy_report: null };
  }

  const { deviation_notes, next_day_plans, agronomy_report } = args;
  
  if (deviation_notes !== undefined) session.draft.meta.deviation_notes = deviation_notes;
  if (next_day_plans !== undefined) session.draft.meta.next_day_plans = next_day_plans;
  if (agronomy_report !== undefined) session.draft.meta.agronomy_report = agronomy_report;

  return {
    success: true,
    message: 'Updated draft metadata.',
    metadata: session.draft.meta
  };
}

/**
 * Confirm grouping decision for multi-plot activity.
 */
function confirm_plot_grouping(session, args) {
  if (!session.draft || !session.draft.activities) return { success: false, message: 'No draft state active.' };

  const activityIndex = session.draft.activities.findIndex(a => a.id === args.activityId);
  if (activityIndex === -1) {
    return { success: false, message: `Activity ${args.activityId} not found.` };
  }

  const activity = session.draft.activities[activityIndex];

  if (args.sameWork) {
    activity.same_work_confirmed = true;
    return {
      success: true,
      message: `Activity ${activity.id} plots [${activity.plot_names.join(', ')}] confirmed as grouped (same work).`
    };
  } else {
    const plots = activity.plot_names || [];
    const newActivities = [];
    
    plots.forEach(plot => {
      newActivities.push({
        id: generateId(),
        activity_type_name: activity.activity_type_name,
        plot_names: [plot],
        crop_name: activity.crop_name,
        acres: null,
        labour_count: null,
        duration_minutes: null,
        expense_amount: null,
        remarks: activity.remarks,
        details: {},
        same_work_confirmed: false,
        _complete: false
      });
    });

    session.draft.activities.splice(activityIndex, 1, ...newActivities);

    return {
      success: true,
      message: `Split grouped activity ${activity.id} into ${newActivities.length} separate activities (different work).`,
      splitActivities: newActivities
    };
  }
}

/**
 * Validate current draft state against the central ACTIVITY_SCHEMA.
 *
 * Rules:
 * - Required fields are read ONLY from ACTIVITY_SCHEMA (src/config/activitySchema.js).
 * - Each activity type has its own baseFields and detailFields — no global assumptions.
 * - acres is required for all activity types.
 * - labour_count / duration_minutes are only required where the schema lists them.
 * - crop_name is only required where the schema lists it in baseFields.
 */
async function validate_draft(session) {
  const result = {
    valid: true,
    tier1_errors: [],
    tier2_errors: [],
    warnings: [],
    missing_fields: [],
    grouping_checks: []
  };

  const draftActivities = session.draft?.activities || [];

  if (draftActivities.length === 0) {
    result.valid = false;
    result.tier2_errors.push('No activities have been recorded in the draft report yet.');
    return result;
  }

  for (const act of draftActivities) {
    // ── Tier 1: Structural Validation ───────────────────────────────────────
    const schema = ACTIVITY_SCHEMA[act.activity_type_name];
    if (!schema) {
      result.valid = false;
      result.tier1_errors.push(`Unknown activity type: "${act.activity_type_name}".`);
      continue;
    }

    // Check plot existence in farm plots
    const validPlots = session.dbCache.plots || [];
    if (act.plot_names && act.plot_names.length > 0) {
      act.plot_names.forEach(plotName => {
        const found = validPlots.find(p => p.plot_code.toLowerCase() === plotName.toLowerCase());
        if (!found) {
          result.valid = false;
          result.tier1_errors.push(`Plot "${plotName}" is not registered on this farm.`);
        }
      });
    }

    // Check crop existence in system crops (if crop_name is specified)
    const validCrops = session.dbCache.allCrops || [];
    if (act.crop_name && act.crop_name.trim()) {
      const foundCrop = validCrops.find(c => c.crop_name.toLowerCase() === act.crop_name.toLowerCase());
      if (!foundCrop) {
        result.valid = false;
        result.tier1_errors.push(`Crop "${act.crop_name}" is not recognized in the system.`);
      }
    }

    // If Tier 1 failed, we skip further checks for this activity to avoid cascade errors
    const hasTier1Error = result.tier1_errors.length > 0;
    if (hasTier1Error) continue;

    // ── Tier 2: Business Validation ─────────────────────────────────────────
    
    // Plot presence
    if (!act.plot_names || act.plot_names.length === 0) {
      result.valid = false;
      result.tier2_errors.push(`Plot code is required for ${schema.label}.`);
      result.missing_fields.push({ activityId: act.id, field: 'plot_names', type: act.activity_type_name });
    } else if (act.plot_names.length > 1 && act.same_work_confirmed === null) {
      result.valid = false;
      result.grouping_checks.push({
        activityId: act.id,
        plot_names: act.plot_names,
        activity_type_name: act.activity_type_name
      });
    }

    // Plot business constraints
    if (act.plot_names && act.plot_names.length > 0) {
      act.plot_names.forEach(plotName => {
        const foundPlot = validPlots.find(p => p.plot_code.toLowerCase() === plotName.toLowerCase());
        if (foundPlot) {
          // Sowing conflict: plot already has an active crop
          if (act.activity_type_name === 'sowing_transplanting' && foundPlot.current_crop_id) {
            result.valid = false;
            result.tier2_errors.push(`Plot ${plotName} already has an active crop assigned. It must be harvested first.`);
          }
          
          // No crop present conflict: activity needs a crop, but plot has none
          if (act.activity_type_name !== 'sowing_transplanting' && schema.baseFields.includes('crop_name')) {
             if (!foundPlot.current_crop_id) {
               result.valid = false;
               result.tier2_errors.push(`Plot ${plotName} does not have any active crop registered. Report sowing first.`);
             }
          }

          // Daily duplicate check
          const duplicates = session.dbCache.submittedToday || [];
          const dup = duplicates.find(
            d => d.plot_id === foundPlot.plot_id && d.activity_type_name === act.activity_type_name
          );
          if (dup) {
            result.valid = false;
            result.tier2_errors.push(`A ${schema.label} report has already been submitted for Plot ${plotName} today.`);
          }
        }
      });
    }

    // Schema-driven base field checks (excluding plot_names)
    const baseFieldsToCheck = schema.baseFields.filter(f => f !== 'plot_names');
    baseFieldsToCheck.forEach(field => {
      const val = act[field];
      if (val === null || val === undefined || val === '') {
        result.valid = false;
        result.tier2_errors.push(`Required field "${getFieldLabel(act.activity_type_name, field)}" is missing.`);
        result.missing_fields.push({ activityId: act.id, field, type: act.activity_type_name });
      }
    });

    // Schema-driven detail field checks
    if (!act.details) act.details = {};
    schema.detailFields.forEach(key => {
      const val = act.details[key];
      if (val === null || val === undefined || val === '') {
        result.valid = false;
        result.tier2_errors.push(`Required detail "${getFieldLabel(act.activity_type_name, `details.${key}`)}" is missing.`);
        result.missing_fields.push({ activityId: act.id, field: `details.${key}`, type: act.activity_type_name });
      }
    });

    // ── Tier 3: Warning Validation (Non-blocking) ───────────────────────────
    
    // Labor check
    const labourCount = act.labour_count !== null && act.labour_count !== undefined ? act.labour_count : act.details?.labour_count;
    if (labourCount > 50) {
      result.warnings.push(`Labour count (${labourCount}) on ${schema.label} is unusually high (over 50).`);
    }

    // Duration check
    const duration = act.duration_minutes !== null && act.duration_minutes !== undefined ? act.duration_minutes : (act.details?.time_minutes || act.details?.machine_time_minutes);
    if (duration > 720) {
      result.warnings.push(`Duration (${Math.round(duration / 60)} hrs) on ${schema.label} is unusually long (over 12 hrs).`);
    }

    // Expense check
    const expense = act.expense_amount !== null && act.expense_amount !== undefined ? act.expense_amount : act.details?.expense_amount;
    if (expense > 100000) {
      result.warnings.push(`Expense (₹${expense}) on ${schema.label} is unusually high (over ₹1,00,000).`);
    }

    // Acreage check
    if (act.acres && act.plot_names && act.plot_names.length === 1) {
      const plot = validPlots.find(p => p.plot_code.toLowerCase() === act.plot_names[0].toLowerCase());
      if (plot && plot.acres && act.acres > plot.acres) {
        result.warnings.push(`Reported acreage (${act.acres} ac) exceeds the registered size of Plot ${plot.plot_code} (${plot.acres} ac).`);
      }
    }

    // Machine time check
    if (act.details && act.details.machine_time_minutes > 720) {
      result.warnings.push(`Machine operation time (${Math.round(act.details.machine_time_minutes / 60)} hrs) is unusually long.`);
    }

    // Harvest quantity check
    if (act.details && act.details.quantity > 500 && act.details.unit === 'tonnes') {
      result.warnings.push(`Harvested quantity (${act.details.quantity} tonnes) is unusually high.`);
    }

    // Complete marker for conversational UI
    const hasMissingForAct =
      result.missing_fields.some(m => m.activityId === act.id) ||
      result.grouping_checks.some(g => g.activityId === act.id);
    act._complete = !hasMissingForAct && !hasTier1Error;
  }

  // Final check: valid if no structural or business errors
  result.valid = (result.tier1_errors.length === 0 && result.tier2_errors.length === 0);
  return result;
}

const crypto = require('crypto');

/**
 * Computes a stable, deterministic hash of the farm context, report date, and canonical draft.
 */
function computeReviewHash(session) {
  const serialized = JSON.stringify({
    farmId: session.farmId,
    reportDate: new Date().toISOString().split('T')[0],
    activities: [...(session.draft?.activities || [])]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(act => ({
        activity_type_name: act.activity_type_name,
        plot_names: [...(act.plot_names || [])].sort(),
        crop_name: act.crop_name,
        acres: act.acres,
        labour_count: act.labour_count,
        duration_minutes: act.duration_minutes,
        expense_amount: act.expense_amount,
        remarks: act.remarks,
        details: act.details || {}
      })),
    meta: session.draft?.meta || {}
  });
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Format and review the draft report using LLM Review Layer.
 */
async function generate_review_summary(session) {
  const farmInfo = {
    farmName: session.farmName,
    farmCode: session.farmCode,
    employeeName: session.employeeName,
    employeeCode: session.employeeCode,
    date: new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  };

  const draftActivities = session.draft?.activities || [];
  const draftMeta = session.draft?.meta || {};

  try {
    const summaryText = await openaiService.callReview(draftActivities, draftMeta, farmInfo);
    if (summaryText) {
      return { success: true, summary: summaryText };
    }
  } catch (err) {
    console.warn('Review LLM call failed, falling back to programmatic format:', err.message);
  }

  // Fallback programmatic summary
  let summary = `📝 *DAILY TASK SHEET REPORT SUMMARY*\n`;
  summary += `----------------------------------------\n`;
  summary += `🌾 *Farm:* ${session.farmName} (${session.farmCode})\n`;
  summary += `📅 *Date:* ${farmInfo.date}\n`;
  summary += `👤 *Reported By:* ${session.employeeName} (${session.employeeCode})\n`;
  summary += `----------------------------------------\n\n`;

  if (draftActivities.length === 0) {
    summary += `*Activities:* No activities recorded.\n\n`;
  } else {
    summary += `*Logged Activities (${draftActivities.length}):*\n`;
    draftActivities.forEach((act, idx) => {
      const typeLabel = act.activity_type_name?.replace(/_/g, ' ').toUpperCase() || 'ACTIVITY';
      summary += `\n*${idx + 1}. ${typeLabel}*\n`;
      summary += `  • Plot(s): ${act.plot_names ? act.plot_names.join(', ') : '-'}\n`;
      summary += `  • Crop: ${act.crop_name || '-'}\n`;
      if (act.acres != null) summary += `  • Acres: ${act.acres} ac\n`;
      if (act.labour_count != null) summary += `  • Labour: ${act.labour_count}\n`;
      if (act.duration_minutes != null) summary += `  • Duration: ${act.duration_minutes} min\n`;
      if (act.expense_amount != null) summary += `  • Expense: ₹${act.expense_amount}\n`;
      if (act.remarks) summary += `  • Remarks: ${act.remarks}\n`;

      if (act.details && Object.keys(act.details).length > 0) {
        let detailsStr = '';
        Object.entries(act.details).forEach(([key, val]) => {
          if (val !== null && val !== undefined) {
            detailsStr += `    - ${key.replace(/_/g, ' ')}: ${val}\n`;
          }
        });
        if (detailsStr) summary += `  • *Details:*\n${detailsStr}`;
      }
    });
    summary += `\n----------------------------------------\n\n`;
  }

  summary += `*Deviation Notes:* ${draftMeta.deviation_notes || 'None'}\n`;
  summary += `*Next Day Plans:* ${draftMeta.next_day_plans || 'None'}\n`;
  summary += `*Agronomy Report:* ${draftMeta.agronomy_report || 'None'}\n`;
  summary += `----------------------------------------`;

  return { success: true, summary };
}

/**
 * Confirm and submit the DTS to the database.
 *
 * Pre-conditions:
 *  1. Only submit when review has been sent & hash generated.
 *  2. Only submit when awaiting approval.
 *  3. Only submit when review hash matches.
 *  4. Only submit when Tier 1 & Tier 2 validation passed.
 */
async function submit_dts(phoneNumber, session) {
  const draftActivities = session.draft?.activities || [];
  if (draftActivities.length === 0) {
    return { success: false, message: 'No draft state found to submit.' };
  }

  // 1. Awaiting Approval Guard
  if (!session.awaiting_approval) {
    return { success: false, message: 'Submission blocked: Not awaiting approval.' };
  }

  // 2. Review Metadata Check
  if (!session.review_metadata || !session.review_metadata.hash) {
    return { success: false, message: 'Submission blocked: Review hash has not been generated.' };
  }

  // 3. Validation Check (Tier 1 & Tier 2)
  const validation = await validate_draft(session);
  if (!validation.valid) {
    const errorMsg = [...(validation.tier1_errors || []), ...(validation.tier2_errors || [])].join('; ');
    console.warn(`[submit_dts] Blocked — Validation errors: ${errorMsg}`);
    return {
      success: false,
      blocked: true,
      message: `Submission blocked: ${errorMsg}`,
      missing_fields: validation.missing_fields,
      errors: errorMsg
    };
  }

  // 4. Hash Gating Check
  const currentHash = computeReviewHash(session);
  if (currentHash !== session.review_metadata.hash) {
    console.warn(`[submit_dts] Blocked — Hash mismatch. current: ${currentHash}, session: ${session.review_metadata.hash}`);
    return {
      success: false,
      blocked: true,
      message: 'Submission blocked: Report content has changed. Please generate review again.'
    };
  }

  // Set submitting status
  session.submission_status = 'submitting';

  // Expand multi-plot grouped activities into individual records
  const expandedActivities = [];
  for (const act of draftActivities) {
    if (act.plot_names && act.plot_names.length > 1) {
      act.plot_names.forEach(plotName => {
        const expanded = { ...act, plot_name: plotName };
        if (act.acres_is_estimate) {
          expanded.remarks = expanded.remarks
            ? `${expanded.remarks} (acres is an estimate)`
            : '(acres is an estimate)';
        }
        expandedActivities.push(expanded);
      });
    } else {
      const expanded = {
        ...act,
        plot_name: act.plot_names && act.plot_names.length > 0 ? act.plot_names[0] : null
      };
      if (act.acres_is_estimate) {
        expanded.remarks = expanded.remarks
          ? `${expanded.remarks} (acres is an estimate)`
          : '(acres is an estimate)';
      }
      expandedActivities.push(expanded);
    }
  }

  session.confirmed_dts_state = {
    activities: expandedActivities,
    deviation_notes: session.draft?.meta?.deviation_notes || null,
    next_day_plans: session.draft?.meta?.next_day_plans || null,
    agronomy_report: session.draft?.meta?.agronomy_report || null
  };

  session.parsedJSON = session.confirmed_dts_state;

  try {
    if (session.submission_mode === 'amendment' && session.dbCache.submission_id) {
      console.log(`[submit_dts] Amending submission ${session.dbCache.submission_id}. Deleting old entries cascade-style first.`);
      await supabaseService.deleteDTSSubmission(session.dbCache.submission_id);
    }
    const res = await submissionService.submitToDB(phoneNumber, session);
    session.submission_status = 'completed';
    return { success: true, message: 'DTS submitted successfully!', submission_id: res.submission_id };
  } catch (err) {
    session.submission_status = 'failed';
    console.error('[submit_dts] DB submission failed:', err);
    throw err;
  }
}

module.exports = {
  add_draft_activity,
  update_draft_dts,
  remove_draft_activity,
  clear_draft_fields,
  update_draft_metadata,
  confirm_plot_grouping,
  validate_draft,
  generate_review_summary,
  submit_dts,
  computeReviewHash
};
