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

const { ACTIVITY_SCHEMA } = require('../config/activitySchema');
const submissionService = require('../handlers/steps/submission');
const openaiService = require('../services/openai');

function generateId() {
  return `act_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

/**
 * Add a new activity to the draft DTS state.
 */
function add_draft_activity(session, args) {
  if (!session.draft_dts_state) {
    session.draft_dts_state = [];
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
    acres_is_estimate: args.acres_is_estimate === true, // true when user gave an estimate rather than exact value
    labour_count: args.labour_count !== undefined ? args.labour_count : null,
    duration_minutes: args.duration_minutes !== undefined ? args.duration_minutes : null,
    expense_amount: args.expense_amount !== undefined ? args.expense_amount : null,
    remarks: args.remarks || null,
    details: args.details || {},
    same_work_confirmed: null, // Null initially for multi-plots
    _complete: false
  };

  session.draft_dts_state.push(newActivity);
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
  if (!session.draft_dts_state) return { success: false, message: 'No draft state active.' };

  const activity = session.draft_dts_state.find(a => a.id === args.activityId);
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
    
    // If the list of plots changed and has >1 plot, reset same_work_confirmed so it gets re-verified
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
  if (!session.draft_dts_state) return { success: false, message: 'No draft state active.' };

  const initialLength = session.draft_dts_state.length;
  session.draft_dts_state = session.draft_dts_state.filter(a => a.id !== args.activityId);

  if (session.draft_dts_state.length < initialLength) {
    return { success: true, message: `Removed activity ${args.activityId}.` };
  } else {
    return { success: false, message: `Activity ${args.activityId} not found.` };
  }
}

/**
 * Clear specific fields from a draft activity.
 */
function clear_draft_fields(session, args) {
  if (!session.draft_dts_state) return { success: false, message: 'No draft state active.' };

  const activity = session.draft_dts_state.find(a => a.id === args.activityId);
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

  // If plot names was cleared or changed, reset grouping flag
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
  if (!session.draft_meta) {
    session.draft_meta = { deviation_notes: null, next_day_plans: null, agronomy_report: null };
  }

  const { deviation_notes, next_day_plans, agronomy_report } = args;
  
  if (deviation_notes !== undefined) session.draft_meta.deviation_notes = deviation_notes;
  if (next_day_plans !== undefined) session.draft_meta.next_day_plans = next_day_plans;
  if (agronomy_report !== undefined) session.draft_meta.agronomy_report = agronomy_report;

  return {
    success: true,
    message: 'Updated draft metadata.',
    metadata: session.draft_meta
  };
}

/**
 * Confirm grouping decision for multi-plot activity.
 */
function confirm_plot_grouping(session, args) {
  if (!session.draft_dts_state) return { success: false, message: 'No draft state active.' };

  const activityIndex = session.draft_dts_state.findIndex(a => a.id === args.activityId);
  if (activityIndex === -1) {
    return { success: false, message: `Activity ${args.activityId} not found.` };
  }

  const activity = session.draft_dts_state[activityIndex];

  if (args.sameWork) {
    // If same work: Mark same_work_confirmed as true and keep them grouped
    activity.same_work_confirmed = true;
    return {
      success: true,
      message: `Activity ${activity.id} plots [${activity.plot_names.join(', ')}] confirmed as grouped (same work).`
    };
  } else {
    // If different work: Split the activity into individual activities per plot
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

    // Remove the original grouped activity and insert the split ones
    session.draft_dts_state.splice(activityIndex, 1, ...newActivities);

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
    errors: [],
    missing_fields: [],
    grouping_checks: []
  };

  if (!session.draft_dts_state || session.draft_dts_state.length === 0) {
    result.valid = false;
    result.errors.push('No activities have been recorded in the draft report yet.');
    return result;
  }

  for (const act of session.draft_dts_state) {

    // ── 1. Resolve schema for this activity type ─────────────────────────
    const schema = ACTIVITY_SCHEMA[act.activity_type_name];
    if (!schema) {
      result.valid = false;
      result.errors.push(`Unknown activity type: "${act.activity_type_name}". Cannot validate.`);
      continue;
    }

    // ── 2. Plot presence & grouping check ────────────────────────────────
    if (!act.plot_names || act.plot_names.length === 0) {
      result.valid = false;
      result.missing_fields.push({ activityId: act.id, field: 'plot_names', type: act.activity_type_name });
    } else if (act.plot_names.length > 1 && act.same_work_confirmed === null) {
      result.valid = false;
      result.grouping_checks.push({
        activityId: act.id,
        plot_names: act.plot_names,
        activity_type_name: act.activity_type_name
      });
    }

    // ── 3. Plot validity against farm cache ──────────────────────────────
    const validPlots = session.dbCache.plots || [];
    const invalidPlots = [];
    if (act.plot_names && act.plot_names.length > 0) {
      act.plot_names.forEach(plotName => {
        const found = validPlots.find(p => p.plot_code.toLowerCase() === plotName.toLowerCase());
        if (!found) {
          invalidPlots.push(plotName);
        } else {
          // Sowing conflict: plot already has an active crop
          if (act.activity_type_name === 'sowing_transplanting' && found.current_crop_id) {
            result.valid = false;
            result.errors.push(`Plot ${plotName} already has a crop assigned. Cannot sow until harvested.`);
          }
          
          // No crop present conflict: activity needs a crop, but plot has none
          if (act.activity_type_name !== 'sowing_transplanting' && schema.baseFields.includes('crop_name')) {
             if (!found.current_crop_id) {
               result.valid = false;
               result.errors.push(`Plot ${plotName} currently does not have any crop registered in the database. Please verify the plot name, or report Sowing/Transplanting first.`);
             }
          }

          // Daily duplicate check
          const duplicates = session.dbCache.submittedToday || [];
          const dup = duplicates.find(
            d => d.plot_id === found.plot_id && d.activity_type_name === act.activity_type_name
          );
          if (dup) {
            result.valid = false;
            result.errors.push(`A ${act.activity_type_name} report has already been submitted for Plot ${plotName} today.`);
          }
        }
      });
    }
    if (invalidPlots.length > 0) {
      result.valid = false;
      result.errors.push(`Plot(s) [${invalidPlots.join(', ')}] are not assigned to farm ${session.farmCode}.`);
    }

    // ── 4. Schema-driven base field checks (excluding plot_names — handled above) ──
    const baseFieldsToCheck = schema.baseFields.filter(f => f !== 'plot_names');
    baseFieldsToCheck.forEach(field => {
      const val = act[field];
      if (val === null || val === undefined || val === '') {
        result.valid = false;
        result.missing_fields.push({ activityId: act.id, field, type: act.activity_type_name });
      }
    });

    // ── 5. Schema-driven detail field checks ─────────────────────────────
    if (!act.details) act.details = {};
    schema.detailFields.forEach(key => {
      const val = act.details[key];
      if (val === null || val === undefined || val === '') {
        result.valid = false;
        result.missing_fields.push({ activityId: act.id, field: `details.${key}`, type: act.activity_type_name });
      }
    });

    // ── 6. Mark activity completion ──────────────────────────────────────
    const hasMissingForAct =
      result.missing_fields.some(m => m.activityId === act.id) ||
      result.grouping_checks.some(g => g.activityId === act.id);
    act._complete = !hasMissingForAct;
  }

  // ── 7. LLM validation hook (only runs after programmatic checks pass) ──
  if (result.valid) {
    try {
      const llmValidation = await openaiService.callValidation(session.draft_dts_state, session.dbCache);
      if (llmValidation && !llmValidation.valid) {
        result.valid = false;
        if (llmValidation.errors) result.errors.push(...llmValidation.errors);
        if (llmValidation.missing_fields) result.missing_fields.push(...llmValidation.missing_fields);
      }
    } catch (err) {
      console.warn('Validation LLM call failed or skipped:', err.message);
    }
  }

  return result;
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

  try {
    const summaryText = await openaiService.callReview(session.draft_dts_state, session.draft_meta, farmInfo);
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

  const activities = session.draft_dts_state || [];
  if (activities.length === 0) {
    summary += `*Activities:* No activities recorded.\n\n`;
  } else {
    summary += `*Logged Activities (${activities.length}):*\n`;
    activities.forEach((act, idx) => {
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

  summary += `*Deviation Notes:* ${session.draft_meta?.deviation_notes || 'None'}\n`;
  summary += `*Next Day Plans:* ${session.draft_meta?.next_day_plans || 'None'}\n`;
  summary += `*Agronomy Report:* ${session.draft_meta?.agronomy_report || 'None'}\n`;
  summary += `----------------------------------------`;

  return { success: true, summary };
}

/**
 * Confirm and submit the DTS to the database.
 *
 * Pre-conditions:
 *  1. All required fields defined by ACTIVITY_SCHEMA must be present (hard block).
 *  2. Multi-plot grouped activities are expanded into one record per plot.
 *  3. If acres_is_estimate is true on any activity, an estimate note is appended
 *     to that activity's remarks field before database insertion.
 */
async function submit_dts(phoneNumber, session) {
  if (!session.draft_dts_state || session.draft_dts_state.length === 0) {
    return { success: false, message: 'No draft state found to submit.' };
  }

  // ── 1. Pre-submission schema validation guard ────────────────────────────
  // Submission is BLOCKED if any required field is missing.
  // The review screen and database call are never reached with incomplete data.
  const validation = await validate_draft(session);
  if (!validation.valid) {
    const missingCount = validation.missing_fields.length;
    const errorCount = validation.errors.length;
    console.warn(`[submit_dts] Blocked — ${missingCount} missing field(s), ${errorCount} error(s).`);
    return {
      success: false,
      blocked: true,
      message: `Submission blocked: ${missingCount} required field(s) are still missing across activities. Please complete all fields before submitting.`,
      missing_fields: validation.missing_fields,
      errors: validation.errors
    };
  }

  // ── 2. Expand multi-plot grouped activities into individual records ───────
  const expandedActivities = [];
  for (const act of session.draft_dts_state) {
    if (act.plot_names && act.plot_names.length > 1) {
      // Grouped plots → one record per plot
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

  // ── 3. Commit confirmed state ─────────────────────────────────────────────
  session.confirmed_dts_state = {
    activities: expandedActivities,
    deviation_notes: session.draft_meta?.deviation_notes || null,
    next_day_plans: session.draft_meta?.next_day_plans || null,
    agronomy_report: session.draft_meta?.agronomy_report || null
  };

  // parsedJSON is the format expected by submitToDB
  session.parsedJSON = session.confirmed_dts_state;

  try {
    const res = await submissionService.submitToDB(phoneNumber, session);
    return { success: true, message: 'DTS submitted successfully!', submission_id: res.submission_id };
  } catch (err) {
    return { success: false, message: `Submission failed: ${err.message}` };
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
  submit_dts
};
