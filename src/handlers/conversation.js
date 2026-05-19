/**
 * Conversation Handler (Rule-Based Agent)
 * Implements the strict 6-step conversational flow.
 */

const sessionService = require('../services/session');
const whatsappService = require('../services/whatsapp');
const openaiService = require('../services/openai');
const supabaseService = require('../services/supabase');

const ACTIVITY_TYPES = [
  { id: 1, name: 'land_preparation', label: 'Land Preparation' },
  { id: 2, name: 'sowing_transplanting', label: 'Sowing / Transplanting' },
  { id: 3, name: 'irrigation', label: 'Irrigation' },
  { id: 4, name: 'weeding', label: 'Weeding' },
  { id: 5, name: 'agri_inputs', label: 'Agri Inputs (Fertilizer/Pesticide)' },
  { id: 6, name: 'other_machinery_usage', label: 'Other Machinery Usage' },
  { id: 7, name: 'harvest', label: 'Harvest' }
];

async function handleIncomingMessage(from, body) {
  if (!body || body.trim().length === 0) return;
  const msg = body.trim();

  let session = await sessionService.getSession(from);

  if (!session) {
    session = await sessionService.createSession(from);
    await whatsappService.sendMessage(from, `Welcome to Zetta Farms Daily Reporting!\n\nPlease send your Farm Code to begin (e.g. ZF-001).`);
    return;
  }

  try {
    switch (session.state) {
      case 'AWAITING_FARM_CODE':
        await handleFarmCode(from, msg, session);
        break;
      case 'ONBOARDING_PLOTS':
        await handleOnboarding(from, msg, session);
        break;
      case 'ASK_ACTIVITIES':
        await handleSelectActivities(from, msg, session);
        break;
      case 'LOOP_ACTIVITIES':
        await handleActivityLoop(from, msg, session);
        break;
      case 'MISSING_FIELDS':
        await handleMissingFields(from, msg, session);
        break;
      case 'FINAL_REVIEW':
        await handleFinalReview(from, msg, session);
        break;
      case 'ASK_MORE_ACTIVITIES':
        await handleMoreActivities(from, msg, session);
        break;
      case 'CONFIRM_DELETE':
        await handleConfirmDelete(from, msg, session);
        break;
      default:
        await sessionService.deleteSession(from);
        await whatsappService.sendMessage(from, "Session reset. Please send your Farm Code.");
    }
  } catch (err) {
    console.error('Conversation Error:', err);
    await whatsappService.sendMessage(from, `Sorry, an error occurred. Please try again.`);
  }
}

// ─────────────────────────────────────────────
// STEP 1: FARM VERIFICATION
// ─────────────────────────────────────────────

async function handleFarmCode(from, msg, session) {
  const code = msg.toUpperCase();
  const farm = await supabaseService.validateFarmCode(code);

  if (!farm) {
    return whatsappService.sendMessage(from, `Farm code not found. Try again:`);
  }

  session.farmId = farm.farm_id;
  session.farmCode = farm.farm_code;
  session.farmName = farm.farm_name;

  const dbCache = await supabaseService.getFarmDetails(farm.farm_id);
  session.dbCache = dbCache;

  // Step 2 Branching: If no plots exist, do onboarding
  if (dbCache.plots.length === 0) {
    session.state = 'ONBOARDING_PLOTS';
    await sessionService.setSession(from, session);
    return whatsappService.sendMessage(from, `We need to set up your plots for ${farm.farm_name}.\n\nPlease reply with a list of your plots and their current crops (e.g. "A1 has Sugarcane, A2 has Cotton").`);
  }

  // Else directly to Step 3
  await promptActivities(from, session);
}

// ─────────────────────────────────────────────
// STEP 2: ONBOARDING
// ─────────────────────────────────────────────

async function handleOnboarding(from, msg, session) {
  // A simple heuristic for parsing "A1 sugarcane, A2 wheat"
  // For production, a 1-shot LLM call is better, but doing simple split here:
  const parts = msg.split(',').map(s => s.trim());
  const plotsData = [];
  
  for (const part of parts) {
    const tokens = part.split(/\s+/);
    if (tokens.length >= 2) {
      plotsData.push({ plot_code: tokens[0], crop_name: tokens[tokens.length - 1] });
    }
  }

  if (plotsData.length === 0) {
    return whatsappService.sendMessage(from, `Could not understand the plots. Please use format: "A1 Sugarcane, A2 Cotton"`);
  }

  await supabaseService.saveFarmOnboarding(session.farmId, plotsData);
  
  // Refresh cache
  session.dbCache = await supabaseService.getFarmDetails(session.farmId);
  
  await whatsappService.sendMessage(from, `Great! Saved ${plotsData.length} plots.`);
  await promptActivities(from, session);
}

// ─────────────────────────────────────────────
// STEP 3: ASK ACTIVITIES
// ─────────────────────────────────────────────

async function promptActivities(from, session) {
  session.state = 'ASK_ACTIVITIES';
  await sessionService.setSession(from, session);

  let text = `Which activities were done today? Reply with numbers (e.g., "3, 4"):\n`;
  ACTIVITY_TYPES.forEach(a => text += `\n${a.id}. ${a.label}`);
  await whatsappService.sendMessage(from, text);
}

async function handleSelectActivities(from, msg, session) {
  const nums = msg.match(/\d+/g);
  if (!nums) return whatsappService.sendMessage(from, `Please send numbers matching the menu.`);

  const selected = nums.map(n => parseInt(n)).filter(n => n >= 1 && n <= 7);
  if (selected.length === 0) return whatsappService.sendMessage(from, `Invalid selection.`);

  const newActivities = selected.map(n => ACTIVITY_TYPES.find(a => a.id === n).name);
  
  // Initialize queues
  session.selectedActivities = newActivities;
  session.currentActivityIndex = 0;
  session.collectedRaw = {};
  
  session.state = 'LOOP_ACTIVITIES';
  await sessionService.setSession(from, session);

  await askNextActivity(from, session);
}

// ─────────────────────────────────────────────
// STEP 4: ACTIVITY LOOP
// ─────────────────────────────────────────────

async function askNextActivity(from, session) {
  if (session.currentActivityIndex >= session.selectedActivities.length) {
    // All activities answered! Call LLM 1
    return runAIParsing(from, session);
  }

  const actName = session.selectedActivities[session.currentActivityIndex];
  const label = ACTIVITY_TYPES.find(a => a.name === actName).label;
  
  await whatsappService.sendMessage(from, `Please provide the details for *${label}*\n(Include Plot, Crop, Time spent, Labour count, etc.)`);
}

async function handleActivityLoop(from, msg, session) {
  const actName = session.selectedActivities[session.currentActivityIndex];
  session.collectedRaw[actName] = msg;
  
  session.currentActivityIndex++;
  await sessionService.setSession(from, session);
  await askNextActivity(from, session);
}

// ─────────────────────────────────────────────
// STEP 4b: LLM PARSING & MISSING FIELDS
// ─────────────────────────────────────────────

async function runAIParsing(from, session) {
  await whatsappService.sendMessage(from, `Analyzing your report...`);
  
  // Build transcript
  let transcript = '';
  for (const act of session.selectedActivities) {
    transcript += `Activity [${act}]: ${session.collectedRaw[act]}\n`;
  }

  // Call 1: Parse unstructured -> JSON
  const parsed = await openaiService.parseActivities(transcript, session.dbCache);
  
  if (!parsed || !parsed.activities) {
    return whatsappService.sendMessage(from, `Failed to analyze text. Please try again.`);
  }

  session.parsedJSON = parsed;

  // Build missing fields queue
  session.missingFieldsQueue = [];
  parsed.activities.forEach((act, idx) => {
    ['plot_name', 'labour_count', 'duration_minutes'].forEach(field => {
      if (act[field] === null) {
        session.missingFieldsQueue.push({ activityIndex: idx, actName: act.activity_type_name, field, isDetail: false });
      }
    });
    // Check specific details
    if (act.details) {
      Object.keys(act.details).forEach(key => {
        if (act.details[key] === null) {
          session.missingFieldsQueue.push({ activityIndex: idx, actName: act.activity_type_name, field: key, isDetail: true });
        }
      });
    }
  });

  if (session.missingFieldsQueue.length > 0) {
    session.state = 'MISSING_FIELDS';
    await sessionService.setSession(from, session);
    await askNextMissingField(from, session);
  } else {
    // No missing fields! Go straight to LLM 2
    await runAIValidation(from, session);
  }
}

async function askNextMissingField(from, session) {
  const missing = session.missingFieldsQueue[0];
  const label = ACTIVITY_TYPES.find(a => a.name === missing.actName).label;
  const friendlyField = missing.field.replace(/_/g, ' ');

  await whatsappService.sendMessage(from, `For *${label}*, what was the ${friendlyField}?`);
}

async function handleMissingFields(from, msg, session) {
  const missing = session.missingFieldsQueue.shift();
  const act = session.parsedJSON.activities[missing.activityIndex];

  let mainVal = msg;
  let extractedUnit = null;

  // If the user was asked for quantity or similar, and provides "10 kgs", split it
  if (['quantity', 'input_qty'].includes(missing.field)) {
    const match = msg.trim().match(/^([\d.]+)\s+([a-zA-Z].*)$/);
    if (match) {
      let val = parseFloat(match[1]);
      let rawUnit = match[2].toLowerCase().trim();
      
      if (rawUnit === 'kgs' || rawUnit === 'kg') {
        mainVal = val / 1000;
        extractedUnit = 'tons';
      } else if (rawUnit === 'tons' || rawUnit === 'ton') {
        mainVal = val;
        extractedUnit = 'tons';
      } else {
        mainVal = match[1];
        extractedUnit = match[2];
      }
    }
  }

  // If they were asked explicitly for 'unit' (because they only gave a number earlier)
  if (missing.field === 'unit') {
    let rawUnit = msg.trim().toLowerCase();
    if (rawUnit === 'kgs' || rawUnit === 'kg') {
      mainVal = 'tons';
      // Find the previously saved quantity and convert it
      if (act.details && act.details.quantity) {
        act.details.quantity = parseFloat(act.details.quantity) / 1000;
      } else if (act.quantity) {
        act.quantity = parseFloat(act.quantity) / 1000;
      }
    } else if (rawUnit === 'tons' || rawUnit === 'ton') {
      mainVal = 'tons';
    }
  }

  // Inject raw string into JSON
  if (missing.isDetail) {
    act.details[missing.field] = mainVal;
  } else {
    act[missing.field] = mainVal;
  }

  // If we extracted a unit from the quantity answer, fill it and remove from queue
  if (extractedUnit) {
    const unitIndex = session.missingFieldsQueue.findIndex(
      q => q.activityIndex === missing.activityIndex && q.field === 'unit'
    );
    if (unitIndex !== -1) {
      const unitQ = session.missingFieldsQueue[unitIndex];
      if (unitQ.isDetail) {
        act.details[unitQ.field] = extractedUnit;
      } else {
        act[unitQ.field] = extractedUnit;
      }
      session.missingFieldsQueue.splice(unitIndex, 1);
    }
  }

  if (session.missingFieldsQueue.length > 0) {
    await sessionService.setSession(from, session);
    await askNextMissingField(from, session);
  } else {
    // All filled! Call LLM 2
    await runAIValidation(from, session);
  }
}

// ─────────────────────────────────────────────
// STEP 4c: LLM VALIDATION & NORMALIZATION
// ─────────────────────────────────────────────

async function runAIValidation(from, session) {
  await whatsappService.sendMessage(from, `Validating final data...`);

  // Call 2: Normalize the filled JSON
  const normalized = await openaiService.normalizeAndValidate(session.parsedJSON, session.dbCache);

  if (!normalized) {
    return whatsappService.sendMessage(from, `Validation failed.`);
  }

  session.parsedJSON = normalized;
  session.state = 'FINAL_REVIEW';
  await sessionService.setSession(from, session);

  await whatsappService.sendMessage(from, `Are you done, or do you have more activities to report? (Reply Yes to submit, No to add more)`);
}

// ─────────────────────────────────────────────
// STEP 5 & 6: FINAL REVIEW
// ─────────────────────────────────────────────

async function handleFinalReview(from, msg, session) {
  const lower = msg.toLowerCase();
  if (lower.includes('yes') || lower.includes('y') || lower.includes('done')) {
    // SUBMIT
    await submitToDB(from, session);
  } else {
    // Step 6
    session.state = 'ASK_MORE_ACTIVITIES';
    await sessionService.setSession(from, session);
    let text = `Which OTHER activities were done today? Reply with numbers (e.g., "3, 4"):\n`;
    ACTIVITY_TYPES.forEach(a => text += `\n${a.id}. ${a.label}`);
    await whatsappService.sendMessage(from, text);
  }
}

async function handleMoreActivities(from, msg, session) {
  const nums = msg.match(/\d+/g);
  if (!nums) return;

  const selected = nums.map(n => parseInt(n)).filter(n => n >= 1 && n <= 7);
  const newActivities = selected.map(n => ACTIVITY_TYPES.find(a => a.id === n).name);

  // Check conflicts
  const conflict = newActivities.find(act => session.selectedActivities.includes(act));
  if (conflict) {
    session.state = 'CONFIRM_DELETE';
    session.conflictAct = conflict;
    await sessionService.setSession(from, session);
    const label = ACTIVITY_TYPES.find(a => a.name === conflict).label;
    return whatsappService.sendMessage(from, `Record already entered for *${label}*. Do you want to delete and re-enter? (Yes/No)`);
  }

  // No conflict, just append
  session.selectedActivities.push(...newActivities);
  session.currentActivityIndex = session.selectedActivities.length - newActivities.length;
  session.state = 'LOOP_ACTIVITIES';
  await sessionService.setSession(from, session);
  await askNextActivity(from, session);
}

async function handleConfirmDelete(from, msg, session) {
  const lower = msg.toLowerCase();
  const label = ACTIVITY_TYPES.find(a => a.name === session.conflictAct).label;

  if (lower.includes('yes') || lower.includes('y')) {
    // Delete from array
    session.selectedActivities = session.selectedActivities.filter(a => a !== session.conflictAct);
    session.parsedJSON.activities = session.parsedJSON.activities.filter(a => a.activity_type_name !== session.conflictAct);
    
    // Add back to end of queue to re-ask
    session.selectedActivities.push(session.conflictAct);
    session.currentActivityIndex = session.selectedActivities.length - 1;
    
    session.state = 'LOOP_ACTIVITIES';
    await sessionService.setSession(from, session);
    await whatsappService.sendMessage(from, `Deleted previous *${label}*. Let's re-enter it.`);
    await askNextActivity(from, session);
  } else {
    // Abort edit, go back to final review
    session.state = 'FINAL_REVIEW';
    await sessionService.setSession(from, session);
    await whatsappService.sendMessage(from, `Are you done? (Yes/No)`);
  }
}

// ─────────────────────────────────────────────
// DB SUBMISSION
// ─────────────────────────────────────────────

async function submitToDB(from, session) {
  const payload = {
    farm_id: session.farmId,
    farm_code_snapshot: session.farmCode,
    farm_name_snapshot: session.farmName,
    report_date: new Date().toISOString().split('T')[0],
    deviation_notes: session.parsedJSON.deviation_notes,
    next_day_plans: session.parsedJSON.next_day_plans,
    agronomy_report: session.parsedJSON.agronomy_report,
    activities: session.parsedJSON.activities
  };

  try {
    const saved = await supabaseService.saveDTSSubmission(payload);
    await whatsappService.sendMessage(from, `✅ Daily Task Sheet Submitted successfully!\nReference ID: ${saved.submission_id}\n\nHave a good evening!`);
    await sessionService.deleteSession(from);
  } catch (err) {
    console.error('Save Error:', err);
    await whatsappService.sendMessage(from, `Failed to save to database. Error: ${err.message}`);
  }
}

module.exports = { handleIncomingMessage };
