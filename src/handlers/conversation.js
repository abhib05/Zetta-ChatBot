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
    session.state = 'AWAITING_EMPLOYEE_CODE';
    await sessionService.setSession(from, session);
    await whatsappService.sendMessage(from, `Welcome to Zetta Farms Daily Reporting!\n\nPlease send your Employee Code to begin (e.g. emp 001).`);
    return;
  }

  const lowerMsg = msg.toLowerCase();
  const RESTART_TRIGGERS = ['restart', 'reset', 'start over', 'start again', 'wrong info', 'cancel'];
  const wantsRestart = RESTART_TRIGGERS.some(t => lowerMsg === t || lowerMsg.startsWith(t + ' '));

  if (session.state !== 'AWAITING_EMPLOYEE_CODE' && wantsRestart) {
    await sessionService.deleteSession(from);
    await whatsappService.sendMessage(from, `Session cleared. All entered data has been discarded.\n\nPlease send your Employee Code to begin again.`);
    return;
  }

  try {
    switch (session.state) {
      case 'AWAITING_EMPLOYEE_CODE':
        await handleEmployeeCode(from, msg, session);
        break;
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
      case 'CONFIRM_CONVERSION':
        await handleConfirmConversion(from, msg, session);
        break;
      case 'FINAL_REVIEW':
        await handleFinalReview(from, msg, session);
        break;
      case 'ASK_MORE_ACTIVITIES':
        await handleMoreActivities(from, msg, session);
        break;
      case 'ASK_NO_ACTIVITY_REASON':
        await handleNoActivityReason(from, msg, session);
        break;
      case 'CONFIRM_DELETE':
        await handleConfirmDelete(from, msg, session);
        break;
      default:
        await sessionService.deleteSession(from);
        await whatsappService.sendMessage(from, "Session reset. Please send your Employee Code.");
    }
  } catch (err) {
    console.error('Conversation Error:', err);
    await whatsappService.sendMessage(from, `Sorry, an error occurred. Please try again.`);
  }
}

// ─────────────────────────────────────────────
// STEP 1 & 2: EMPLOYEE & FARM VERIFICATION
// ─────────────────────────────────────────────

async function handleEmployeeCode(from, msg, session) {
  const code = msg.trim();
  const employee = await supabaseService.validateEmployeeCode(code);

  if (!employee) {
    return whatsappService.sendMessage(from, `Employee code not found or inactive. Try again:`);
  }

  session.employeeId = employee.employee_id;
  session.employeeName = employee.employee_name;
  session.employeeCode = employee.employee_code;
  session.state = 'AWAITING_FARM_CODE';
  await sessionService.setSession(from, session);

  await whatsappService.sendMessage(from, `Welcome ${employee.employee_name}!\n\nPlease send the Farm Code you are reporting for (e.g. ZF-001).`);
}

async function handleFarmCode(from, msg, session) {
  const code = msg.toUpperCase();
  const farm = await supabaseService.validateEmployeeFarmAccess(session.employeeId, code);

  if (!farm) {
    return whatsappService.sendMessage(from, `Farm code not found or you are not authorized for this farm. Try again:`);
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
  text += `\n8. Nothing more to add`;
  text += `\n9. No activities done today`;
  await whatsappService.sendMessage(from, text);
}

async function handleSelectActivities(from, msg, session) {
  const nums = msg.match(/\d+/g);
  if (!nums) return whatsappService.sendMessage(from, `Please send numbers matching the menu.`);

  const selected = nums.map(n => parseInt(n)).filter(n => n >= 1 && n <= 9);
  if (selected.length === 0) return whatsappService.sendMessage(from, `Invalid selection.`);

  if (selected.includes(9)) {
    session.state = 'ASK_NO_ACTIVITY_REASON';
    await sessionService.setSession(from, session);
    return whatsappService.sendMessage(from, `Please provide the reason for not doing any activities today.`);
  }

  if (selected.includes(8)) {
    return whatsappService.sendMessage(from, `You haven't selected any activities yet. Do you want to add new data (choose 1-7) or proceed with 9 (No activities done today)?`);
  }

  const newActivities = selected.filter(n => n >= 1 && n <= 7).map(n => ACTIVITY_TYPES.find(a => a.id === n).name);
  
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
  
  // Find which activities haven't been parsed yet
  const unparsedActivities = session.selectedActivities.filter(actName => 
    !session.parsedJSON || !session.parsedJSON.activities || !session.parsedJSON.activities.find(a => a.activity_type_name === actName)
  );

  if (unparsedActivities.length > 0) {
    // Build transcript
    let transcript = '';
    for (const act of unparsedActivities) {
      transcript += `Activity [${act}]: ${session.collectedRaw[act]}\n`;
    }

    // Call 1: Parse unstructured -> JSON
    const parsed = await openaiService.parseActivities(transcript, session.dbCache);
    
    if (!parsed || !parsed.activities) {
      return whatsappService.sendMessage(from, `Failed to analyze text. Please try again.`);
    }

    if (!session.parsedJSON) {
      session.parsedJSON = parsed;
    } else {
      if (!session.parsedJSON.activities) session.parsedJSON.activities = [];
      session.parsedJSON.activities.push(...parsed.activities);
    }
  }

  // Build missing fields queue.
  // NOTE: session.parsedJSON is guaranteed non-null here — the early return on L249
  // handles the only failure case (LLM returned null), and the if-block above always
  // populates session.parsedJSON before we reach this point.
  const EXPECTED_DETAILS = {
    land_preparation:      ['activity_name', 'machine_name'],
    sowing_transplanting:  ['seed_rate_per_acre', 'plants_sown', 'sowing_method', 'machine_time_minutes'],
    irrigation:            ['irrigation_method', 'power_source', 'fuel_used_litres'],
    weeding:               ['weeding_method', 'input_name', 'input_qty'],
    agri_inputs:           ['input_method', 'input_type', 'input_name', 'input_qty'],
    other_machinery_usage: ['machine_name', 'fuel_used_litres'],
    harvest:               ['harvest_cycle_no', 'harvesting_method', 'quantity', 'unit', 'machine_time_minutes'],
  };

  session.missingFieldsQueue = [];
  session.parsedJSON.activities.forEach((act, idx) => {
    ['plot_name', 'labour_count', 'duration_minutes'].forEach(field => {
      if (act[field] === null || act[field] === undefined) {
        session.missingFieldsQueue.push({ activityIndex: idx, actName: act.activity_type_name, field, isDetail: false });
      }
    });

    const expectedKeys = EXPECTED_DETAILS[act.activity_type_name] || [];
    if (!act.details) act.details = {};

    expectedKeys.forEach(key => {
      if (act.details[key] === null || act.details[key] === undefined) {
        session.missingFieldsQueue.push({ activityIndex: idx, actName: act.activity_type_name, field: key, isDetail: true });
      }
    });
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

  let prompt = `For *${label}*, what was the ${friendlyField}?`;
  
  if (missing.field === 'quantity') {
    prompt = `For *${label}*, what was the ${friendlyField}? (Please provide the value in tonnes)`;
  } else if (missing.field === 'input_qty') {
    prompt = `For *${label}*, what was the ${friendlyField}? (Please provide the value in kgs)`;
  }

  await whatsappService.sendMessage(from, prompt);
}

async function handleMissingFields(from, msg, session) {
  const missing = session.missingFieldsQueue[0];
  const act = session.parsedJSON.activities[missing.activityIndex];

  let mainVal = msg;
  let extractedUnit = null;
  let needsConfirm = false;

  // If the user was asked for quantity or similar, and provides "10 kgs", split it
  if (['quantity', 'input_qty'].includes(missing.field)) {
    const match = msg.trim().match(/^([\d.]+)\s*([a-zA-Z].*)*$/);
    if (match) {
      let val = parseFloat(match[1]);
      let rawUnit = match[2] ? match[2].toLowerCase().trim() : '';
      let targetUnit = missing.field === 'quantity' ? 'tonnes' : 'kgs';
      let convertedVal = val;

      if (missing.field === 'quantity') {
        if (rawUnit === 'kgs' || rawUnit === 'kg') {
          convertedVal = val / 1000;
          needsConfirm = true;
        } else {
          extractedUnit = 'tons';
        }
      } else if (missing.field === 'input_qty') {
        if (rawUnit === 'tons' || rawUnit === 'ton' || rawUnit === 'tonnes') {
          convertedVal = val * 1000;
          needsConfirm = true;
        }
      }

      if (needsConfirm) {
        session.state = 'CONFIRM_CONVERSION';
        session.pendingConversion = {
           val: convertedVal,
           originalMsg: msg,
           targetUnit: targetUnit,
           extractedUnit: missing.field === 'quantity' ? 'tons' : null
        };
        await sessionService.setSession(from, session);
        return whatsappService.sendMessage(from, `You entered ${msg}. I will save this as ${convertedVal} ${targetUnit}. Is this correct? (Yes/No)`);
      } else {
        mainVal = val;
      }
    }
  }

  // If they were asked explicitly for 'unit' (because they only gave a number earlier)
  if (missing.field === 'unit') {
    let rawUnit = msg.trim().toLowerCase();
    if (rawUnit === 'kgs' || rawUnit === 'kg') {
      let currentQ = act.details && act.details.quantity ? act.details.quantity : act.quantity;
      let newQ = parseFloat(currentQ) / 1000;
      
      session.state = 'CONFIRM_CONVERSION';
      session.pendingConversion = {
         val: 'tons',
         originalMsg: msg,
         targetUnit: 'tons',
         isUnitField: true,
         newQuantity: newQ
      };
      await sessionService.setSession(from, session);
      return whatsappService.sendMessage(from, `You entered ${msg}. I will convert the previously entered quantity (${currentQ}) to ${newQ} tonnes. Is this correct? (Yes/No)`);
    } else {
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
  if (extractedUnit || (missing.field === 'quantity' && !needsConfirm)) {
    let u = extractedUnit || 'tons';
    const unitIndex = session.missingFieldsQueue.findIndex(
      q => q.activityIndex === missing.activityIndex && q.field === 'unit'
    );
    if (unitIndex !== -1) {
      const unitQ = session.missingFieldsQueue[unitIndex];
      if (unitQ.isDetail) {
        act.details[unitQ.field] = u;
      } else {
        act[unitQ.field] = u;
      }
      session.missingFieldsQueue.splice(unitIndex, 1);
    }
  }

  session.missingFieldsQueue.shift();

  if (session.missingFieldsQueue.length > 0) {
    await sessionService.setSession(from, session);
    await askNextMissingField(from, session);
  } else {
    // All filled! Call LLM 2
    await runAIValidation(from, session);
  }
}

async function handleConfirmConversion(from, msg, session) {
  const lower = msg.toLowerCase();
  const missing = session.missingFieldsQueue[0];
  const act = session.parsedJSON.activities[missing.activityIndex];

  if (lower.includes('yes') || lower.includes('y')) {
    const { val, extractedUnit, isUnitField, newQuantity } = session.pendingConversion;
    
    if (isUnitField) {
      if (missing.isDetail) {
        act.details[missing.field] = val; // 'tons'
        if (act.details.quantity) act.details.quantity = newQuantity;
      } else {
        act[missing.field] = val;
        if (act.quantity) act.quantity = newQuantity;
      }
    } else {
      if (missing.isDetail) {
        act.details[missing.field] = val;
      } else {
        act[missing.field] = val;
      }

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
    }

    session.missingFieldsQueue.shift();
    session.pendingConversion = null;
    
    if (session.missingFieldsQueue.length > 0) {
      session.state = 'MISSING_FIELDS';
      await sessionService.setSession(from, session);
      await askNextMissingField(from, session);
    } else {
      await runAIValidation(from, session);
    }
  } else {
    // If no, ask them to re-enter the value
    session.pendingConversion = null;
    session.state = 'MISSING_FIELDS';
    await sessionService.setSession(from, session);
    await askNextMissingField(from, session);
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
    text += `\n8. Nothing more to add`;
    text += `\n9. No activities done today`;
    await whatsappService.sendMessage(from, text);
  }
}

async function handleMoreActivities(from, msg, session) {
  const lower = msg.toLowerCase();
  
  // Safely check if they are done adding activities. 
  // Removed 'no' and 'cancel' to prevent accidental submission of incomplete data.
  if (lower === 'done' || lower === 'no more' || lower === 'none' || lower === 'submit') {
    return submitToDB(from, session);
  }

  const nums = msg.match(/\d+/g);
  if (!nums) {
    return whatsappService.sendMessage(from, `Please reply with numbers (e.g., "3, 4") or type "Done" to submit your report.`);
  }

  const selected = nums.map(n => parseInt(n)).filter(n => n >= 1 && n <= 9);
  if (selected.length === 0) {
    return whatsappService.sendMessage(from, `Invalid selection. Please reply with numbers between 1 and 9.`);
  }

  if (selected.includes(8)) {
    return submitToDB(from, session);
  }

  if (selected.includes(9)) {
    return whatsappService.sendMessage(from, `You've already reported activities today. If you are done, reply with 8.`);
  }

  const newActivities = selected.filter(n => n >= 1 && n <= 7).map(n => ACTIVITY_TYPES.find(a => a.id === n).name);

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

async function handleNoActivityReason(from, msg, session) {
  session.parsedJSON = {
    activities: [],
    deviation_notes: `No activities today. Reason: ${msg}`,
    next_day_plans: null,
    agronomy_report: null
  };
  await submitToDB(from, session);
}

// ─────────────────────────────────────────────
// DB SUBMISSION
// ─────────────────────────────────────────────

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

module.exports = { handleIncomingMessage };
