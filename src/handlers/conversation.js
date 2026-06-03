/**
 * Conversation Handler — Production Deterministic Workflow Engine
 */

const sessionService = require('../services/session');
const whatsappService = require('../services/whatsapp');
const supabaseService = require('../services/supabase');
const openaiService = require('../services/openai');
const toolHandlers = require('../llm/toolHandlers');
const entityResolver = require('../services/entityResolver');
const { classifyIntent } = require('../services/intentClassifier');
const { ACTIVITY_TYPES } = require('./steps/constants');

/**
 * Reconstructs the original grouped draft activities from individual database rows.
 */
function mapDBToDraft(dbSubmission) {
  const draft = {
    activities: [],
    meta: {
      deviation_notes: dbSubmission.deviation_notes || null,
      next_day_plans: dbSubmission.next_day_plans || null,
      agronomy_report: dbSubmission.agronomy_report || null
    }
  };

  if (dbSubmission.dts_activity_entries && Array.isArray(dbSubmission.dts_activity_entries)) {
    dbSubmission.dts_activity_entries.forEach(entry => {
      const typeName = entry.activity_types?.name;
      if (!typeName) return;

      const plotName = entry.farm_plots?.plot_code || null;

      // Extract details from specific detail table join
      let details = {};
      const detailTableKey = `dts_${typeName}_details`;
      const detailRows = entry[detailTableKey];
      if (detailRows && detailRows.length > 0) {
        const rawDetails = { ...detailRows[0] };
        delete rawDetails.id;
        delete rawDetails.entry_id;
        delete rawDetails.created_at;
        details = rawDetails;
      }

      // Group activities with matching metadata and details to restore original draft representation
      const existing = draft.activities.find(act => 
        act.activity_type_name === typeName &&
        act.crop_name === (entry.crops?.crop_name || null) &&
        act.remarks === (entry.remarks || null) &&
        act.labour_count === entry.labour_count &&
        act.duration_minutes === entry.duration_minutes &&
        act.expense_amount === entry.expense_amount &&
        JSON.stringify(act.details) === JSON.stringify(details)
      );

      if (existing) {
        if (plotName && !existing.plot_names.includes(plotName)) {
          existing.plot_names.push(plotName);
        }
      } else {
        draft.activities.push({
          id: entry.entry_id || `act_${Date.now()}_${Math.floor(Math.random() * 1005)}`,
          activity_type_name: typeName,
          plot_names: plotName ? [plotName] : [],
          crop_name: entry.crops?.crop_name || null,
          acres: entry.acres ? parseFloat(entry.acres) : null,
          acres_is_estimate: false,
          labour_count: entry.labour_count,
          duration_minutes: entry.duration_minutes,
          expense_amount: entry.expense_amount ? parseFloat(entry.expense_amount) : null,
          remarks: entry.remarks || null,
          details: details,
          same_work_confirmed: true,
          _complete: true
        });
      }
    });
  }

  return draft;
}

/**
 * Intelligent metadata refresh policy
 */
async function refreshMetadataIfNeeded(session, force = false) {
  const cache = session.dbCache || {};
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  const age = cache.lastRefreshed ? now - new Date(cache.lastRefreshed).getTime() : Infinity;

  if (force || age > fiveMinutes) {
    console.log(`[Metadata] Refreshing cache for farm ${session.farmCode} (age: ${age}ms, force: ${force})`);
    const freshDetails = await supabaseService.getFarmDetails(session.farmId);
    session.dbCache = {
      ...freshDetails,
      lastRefreshed: new Date().toISOString()
    };
  }
}

/**
 * Upserts extracted/resolved activities into draft state.
 */
function upsertDraftActivities(session, extractedActivities) {
  session.draft = session.draft || { activities: [], meta: { deviation_notes: null, next_day_plans: null, agronomy_report: null } };
  session.draft.activities = session.draft.activities || [];

  extractedActivities.forEach(ext => {
    let matched = null;
    if (ext.plot_names && ext.plot_names.length > 0) {
      matched = session.draft.activities.find(act => 
        act.activity_type_name === ext.activity_type_name &&
        act.plot_names && act.plot_names.some(p => ext.plot_names.includes(p))
      );
    }

    if (matched) {
      const allowedFields = ['crop_name', 'acres', 'acres_is_estimate', 'labour_count', 'duration_minutes', 'expense_amount', 'remarks'];
      allowedFields.forEach(f => {
        if (ext[f] !== null && ext[f] !== undefined && ext[f] !== '') {
          matched[f] = ext[f];
        }
      });
      if (ext.details && typeof ext.details === 'object') {
        matched.details = matched.details || {};
        Object.entries(ext.details).forEach(([k, v]) => {
          if (v !== null && v !== undefined && v !== '') {
            matched.details[k] = v;
          }
        });
      }
      if (ext.plot_names) {
        ext.plot_names.forEach(p => {
          if (!matched.plot_names.includes(p)) {
            matched.plot_names.push(p);
          }
        });
      }
    } else {
      session.draft.activities.push({
        id: `act_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        activity_type_name: ext.activity_type_name,
        plot_names: ext.plot_names || [],
        crop_name: ext.crop_name || null,
        acres: ext.acres !== undefined ? ext.acres : null,
        acres_is_estimate: ext.acres_is_estimate === true,
        labour_count: ext.labour_count !== undefined ? ext.labour_count : null,
        duration_minutes: ext.duration_minutes !== undefined ? ext.duration_minutes : null,
        expense_amount: ext.expense_amount !== undefined ? ext.expense_amount : null,
        remarks: ext.remarks || null,
        details: ext.details || {},
        same_work_confirmed: null,
        _complete: false
      });
    }
  });
}

/**
 * Applies targeted correction to the last active or targeted activity.
 */
function applyCorrection(session, extractedData) {
  let targetActivity = null;

  if (session.correction_context && session.correction_context.activity_id) {
    const expiresAt = new Date(session.correction_context.expires_at).getTime();
    if (Date.now() < expiresAt) {
      targetActivity = session.draft.activities.find(a => a.id === session.correction_context.activity_id);
    }
  }

  if (!targetActivity && session.draft.activities.length > 0) {
    targetActivity = session.draft.activities[session.draft.activities.length - 1];
  }

  if (targetActivity && extractedData.activities && extractedData.activities.length > 0) {
    const ext = extractedData.activities[0];
    const allowedFields = ['crop_name', 'acres', 'acres_is_estimate', 'labour_count', 'duration_minutes', 'expense_amount', 'remarks', 'plot_names'];
    const editedFields = [];

    allowedFields.forEach(f => {
      if (ext[f] !== null && ext[f] !== undefined && ext[f] !== '') {
        targetActivity[f] = ext[f];
        editedFields.push(f);
      }
    });

    if (ext.details && typeof ext.details === 'object') {
      targetActivity.details = targetActivity.details || {};
      Object.entries(ext.details).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') {
          targetActivity.details[k] = v;
          editedFields.push(`details.${k}`);
        }
      });
    }

    session.correction_context = {
      activity_id: targetActivity.id,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      recently_edited_fields: editedFields
    };

    console.log(`[Correction] Applied to activity ${targetActivity.id} (${targetActivity.activity_type_name}): ${editedFields.join(', ')}`);
    return true;
  }
  return false;
}

/**
 * Deterministically maps direct replies to the targeted pending clarification field.
 */
function resolveClarification(session, msg, extractedData) {
  if (!session.pending_clarification) return false;

  const { activity_id, field } = session.pending_clarification;
  const targetActivity = session.draft.activities.find(a => a.id === activity_id);
  if (!targetActivity) {
    session.pending_clarification = null;
    return false;
  }

  let valueMapped = null;
  const lowerMsg = msg.toLowerCase().trim();

  // 1. Try strict programmatic mapping for digits / exact keywords
  const numFields = ['labour_count', 'duration_minutes', 'acres', 'expense_amount'];
  const isNumberField = numFields.includes(field) || field.startsWith('details.time') || field.startsWith('details.machine') || field.endsWith('qty') || field.endsWith('count') || field.endsWith('amount');

  if (isNumberField) {
    const num = parseFloat(lowerMsg.replace(/[^\d.]/g, ''));
    if (!isNaN(num)) {
      valueMapped = num;
    }
  } else if (field === 'plot_names') {
    const resolvedPlot = entityResolver.resolvePlot(lowerMsg, session.dbCache.plots);
    const validPlots = session.dbCache.plots || [];
    if (validPlots.some(p => p.plot_code.toLowerCase() === resolvedPlot.toLowerCase())) {
      valueMapped = [resolvedPlot];
    }
  } else if (field === 'crop_name') {
    const resolvedCrop = entityResolver.resolveCrop(lowerMsg, session.dbCache.allCrops);
    const validCrops = session.dbCache.allCrops || [];
    if (validCrops.some(c => c.crop_name.toLowerCase() === resolvedCrop.toLowerCase())) {
      valueMapped = resolvedCrop;
    }
  } else if (field === 'details.power_source') {
    if (['solar', 'electricity', 'generator'].includes(lowerMsg)) {
      valueMapped = lowerMsg;
    }
  }

  // 2. Fall back to extraction layer value if program matching was unable to map it
  if (valueMapped === null && extractedData && extractedData.activities && extractedData.activities.length > 0) {
    const extAct = extractedData.activities[0];
    if (field.startsWith('details.')) {
      const detailKey = field.split('.')[1];
      if (extAct.details && extAct.details[detailKey] !== undefined && extAct.details[detailKey] !== null) {
        valueMapped = extAct.details[detailKey];
      }
    } else {
      if (extAct[field] !== undefined && extAct[field] !== null) {
        valueMapped = extAct[field];
      }
    }
  }

  if (valueMapped !== null) {
    if (field.startsWith('details.')) {
      const detailKey = field.split('.')[1];
      targetActivity.details = targetActivity.details || {};
      targetActivity.details[detailKey] = valueMapped;
    } else {
      targetActivity[field] = valueMapped;
    }
    session.pending_clarification = null;
    return true;
  }
  return false;
}

/**
 * Main handler routing logic
 */
async function handleIncomingMessage(from, body) {
  if (!body || body.trim().length === 0) return;
  const msg = body.trim();
  const lowerMsg = msg.toLowerCase();

  const RESTART_TRIGGERS = ['restart', 'reset', 'start over', 'start again', 'wrong info', 'cancel'];
  const wantsRestart = RESTART_TRIGGERS.some(t => lowerMsg === t || lowerMsg.startsWith(t + ' '));

  let session = await sessionService.getSession(from);

  if (wantsRestart && session) {
    await sessionService.deleteSession(from);
    session = null;
    await whatsappService.sendMessage(from, "Session reset. Send any message to start a new report.");
    return;
  }

  // 1. Programmatic Authentication & Authorization
  if (!session) {
    const employeeInfo = await supabaseService.findEmployeeByPhone(from);
    if (!employeeInfo) {
      await whatsappService.sendMessage(from, `Welcome to Zetta Farms Daily Reporting!\n\nYour phone number (${from}) is not registered in our system. Please contact your administrator to set up your access.`);
      return;
    }

    const farms = employeeInfo.farms || [];
    if (farms.length === 0) {
      await whatsappService.sendMessage(from, `Welcome ${employeeInfo.employee_name}!\n\nYou currently do not have any farm assigned to you. Please contact your administrator.`);
      return;
    }

    session = await sessionService.createSession(from);
    session.employeeId = employeeInfo.employee_id;
    session.employeeName = employeeInfo.employee_name;
    session.employeeCode = employeeInfo.employee_code;

    if (farms.length === 1) {
      const farm = farms[0];
      session.farmId = farm.farm_id;
      session.farmCode = farm.farm_code;
      session.farmName = farm.farm_name;
      
      await refreshMetadataIfNeeded(session, true);
      
      if (session.dbCache.submission_id) {
        session.phase = 'DUPLICATE_CHECK';
        await sessionService.setSession(from, session);
        await whatsappService.sendMessage(from, `Hey ${session.employeeName}, you have already submitted a report for ${session.farmCode} today.\n\nDo you want to *Check* the report, *Amend* it (edit), or *Overwrite* it?`);
        return;
      }

      session.phase = 'COLLECTING';
      await sessionService.setSession(from, session);
      const activityList = ACTIVITY_TYPES.map(a => a.label).join(', ');
      await whatsappService.sendMessage(from, `Hey ${session.employeeName}, ${session.farmCode} is your farm code. Let's start your report.\n\nPlease tell me what activities were done today. You can report:\n${activityList}`);
      return;
    } else {
      session.phase = 'FARM_SELECTION';
      session.availableFarms = farms;
      await sessionService.setSession(from, session);

      let msgText = `Welcome back, *${session.employeeName}*!\n\nYou have multiple farms assigned. Please reply with the farm code(s) you are reporting for today:\n`;
      farms.forEach((f, idx) => {
        msgText += `\n${idx + 1}. *${f.farm_code}* (${f.farm_name})`;
      });
      await whatsappService.sendMessage(from, msgText);
      return;
    }
  }

  // 2. 5-Minute Inactivity Timeout Check
  if (session.lastActivity && session.phase !== 'FARM_SELECTION') {
    const timeSinceLastActivity = Date.now() - new Date(session.lastActivity).getTime();
    const FIVE_MINUTES = 5 * 60 * 1000;

    if (timeSinceLastActivity > FIVE_MINUTES && !session.pendingTimeoutChoice) {
      // Classify the message to see if we can resume automatically
      const intent = await classifyIntent(msg);
      const actionable = ['REPORTING', 'CORRECTION', 'APPROVAL'].includes(intent);
      
      if (actionable) {
        console.log(`[Timeout] Auto-resuming timed out session for ${from} due to actionable intent: ${intent}`);
        await whatsappService.sendMessage(from, "Resuming your previous report...");
      } else {
        session.pendingTimeoutChoice = true;
        await sessionService.setSession(from, session);
        await whatsappService.sendMessage(from, "Your previous session timed out. Would you like to resume your previous report, or start a new report? (Reply Resume / New)");
        return;
      }
    }
  }

  // 3. Handle Timeout Choice
  if (session.pendingTimeoutChoice) {
    if (lowerMsg.includes('resume') || lowerMsg === 'yes' || lowerMsg === 'y' || lowerMsg.includes('continue')) {
      session.pendingTimeoutChoice = false;
      session.lastActivity = new Date().toISOString();
      await sessionService.setSession(from, session);

      const reviewRes = await toolHandlers.generate_review_summary(session);
      await whatsappService.sendMessage(from, `Resumed report. Here is the summary:\n\n${reviewRes.summary}\n\nLet's continue. Please tell me if you have any updates.`);
      return;
    } else if (lowerMsg.includes('new') || lowerMsg === 'no' || lowerMsg === 'n' || lowerMsg.includes('start over')) {
      await sessionService.deleteSession(from);
      await whatsappService.sendMessage(from, "Starting a new report.");
      return handleIncomingMessage(from, "hi");
    } else {
      await whatsappService.sendMessage(from, "Please reply *Resume* to continue your previous report, or *New* to start a new one.");
      return;
    }
  }

  // 4. Handle Farm Selection Phase
  if (session.phase === 'FARM_SELECTION') {
    const selectedCodes = await openaiService.callFarmSelection(msg, session.availableFarms);
    const matchedFarms = [];
    selectedCodes.forEach(code => {
      const f = session.availableFarms.find(farm => farm.farm_code === code);
      if (f && !matchedFarms.some(existing => existing.farm_id === f.farm_id)) {
        matchedFarms.push(f);
      }
    });

    if (matchedFarms.length === 0) {
      let errorMsg = `Could not match any farm code. Please reply with one or more of the assigned Farm Codes:\n`;
      session.availableFarms.forEach((f, idx) => {
        errorMsg += `\n${idx + 1}. *${f.farm_code}* (${f.farm_name})`;
      });
      await whatsappService.sendMessage(from, errorMsg);
      return;
    }

    const activeFarm = matchedFarms[0];
    session.farmId = activeFarm.farm_id;
    session.farmCode = activeFarm.farm_code;
    session.farmName = activeFarm.farm_name;
    
    await refreshMetadataIfNeeded(session, true);
    
    if (matchedFarms.length > 1) {
      session.pendingFarmsQueue = matchedFarms.slice(1);
    } else {
      session.pendingFarmsQueue = [];
    }

    if (session.dbCache.submission_id) {
      session.phase = 'DUPLICATE_CHECK';
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Starting with *${session.farmCode}* (${session.farmName}).\n\n⚠️ You have already submitted a report for this farm today.\n\nDo you want to *Check* the report, *Amend* it (edit), or *Overwrite* it?`);
      return;
    }

    session.phase = 'COLLECTING';
    await sessionService.setSession(from, session);
    const activityList = ACTIVITY_TYPES.map(a => a.label).join(', ');
    await whatsappService.sendMessage(from, `Got it. Reporting for *${session.farmCode}* (${session.farmName}) today. Please report your activities. You can report:\n${activityList}`);
    return;
  }

  // 5. Handle Duplicate Check States
  if (session.phase === 'DUPLICATE_CHECK') {
    if (lowerMsg.includes('check')) {
      const summary = await supabaseService.getDTSSubmissionSummary(session.dbCache.submission_id);
      session.phase = 'DUPLICATE_CHECK_POST_REVIEW';
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, summary);
      await whatsappService.sendMessage(from, `Do you want to *Amend* this report, *Overwrite* it, or *End* the chat?`);
      return;
    } else if (lowerMsg.includes('amend') || lowerMsg.includes('edit')) {
      await whatsappService.sendMessage(from, "Loading submitted report for amendment...");
      try {
        const dbSub = await supabaseService.getDTSSubmission(session.dbCache.submission_id);
        session.draft = mapDBToDraft(dbSub);
        session.submission_mode = 'amendment';
        session.phase = 'COLLECTING';
        
        await refreshMetadataIfNeeded(session, true);
        
        const reviewText = await toolHandlers.generate_review_summary(session);
        session.review_metadata = {
          hash: toolHandlers.computeReviewHash(session),
          generated_at: new Date().toISOString()
        };
        session.awaiting_approval = true;
        await sessionService.setSession(from, session);
        await whatsappService.sendMessage(from, `Report loaded successfully:\n\n${reviewText.summary}\n\nWhat would you like to update or add?`);
      } catch (err) {
        await whatsappService.sendMessage(from, "Failed to load report. Starting fresh instead.");
        session.phase = 'COLLECTING';
        await sessionService.setSession(from, session);
      }
      return;
    } else if (lowerMsg.includes('overwrite') || lowerMsg.includes('new')) {
      session.phase = 'OVERWRITE_CONFIRMATION';
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Do you really want to delete the existing report? (Reply YES or NO)`);
      return;
    } else {
      await whatsappService.sendMessage(from, `Please reply *Check* to view the report, *Amend* to edit it, or *Overwrite* to start fresh.`);
      return;
    }
  }

  if (session.phase === 'DUPLICATE_CHECK_POST_REVIEW') {
    if (lowerMsg.includes('amend') || lowerMsg.includes('edit')) {
      session.phase = 'DUPLICATE_CHECK';
      return handleIncomingMessage(from, 'amend');
    } else if (lowerMsg.includes('overwrite') || lowerMsg.includes('new') || lowerMsg === 'yes') {
      session.phase = 'OVERWRITE_CONFIRMATION';
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Do you really want to delete the existing report? (Reply YES or NO)`);
      return;
    } else if (lowerMsg.includes('end') || lowerMsg.includes('no')) {
      await whatsappService.sendMessage(from, `Thank you. Have a good day!`);
      await sessionService.deleteSession(from);
      return;
    } else {
      await whatsappService.sendMessage(from, `Please reply *Amend* to edit, *Overwrite* to delete and start fresh, or *End* to close.`);
      return;
    }
  }

  if (session.phase === 'OVERWRITE_CONFIRMATION') {
    if (lowerMsg === 'yes' || lowerMsg === 'y') {
      await whatsappService.sendMessage(from, `Deleting the existing report...`);
      await supabaseService.deleteDTSSubmission(session.dbCache.submission_id);
      
      session.phase = 'COLLECTING';
      session.dbCache.submission_id = null;
      session.dbCache.submittedToday = [];
      session.draft = { activities: [], meta: { deviation_notes: null, next_day_plans: null, agronomy_report: null } };
      session.submission_mode = 'draft';
      await sessionService.setSession(from, session);
      
      await whatsappService.sendMessage(from, `Deleted. Let's start fresh. Please tell me what activities you have done today.`);
      return;
    } else if (lowerMsg === 'no' || lowerMsg === 'n') {
      await whatsappService.sendMessage(from, `Keeping the existing report. Have a good day!`);
      await sessionService.deleteSession(from);
      return;
    } else {
      await whatsappService.sendMessage(from, `Do you really want to delete the existing report? (Please reply YES or NO)`);
      return;
    }
  }

  // 6. Handle Plot Grouping Confirmation
  if (session.pendingGroupConflict) {
    const conflict = session.pendingGroupConflict;
    if (lowerMsg === 'yes' || lowerMsg === 'y' || lowerMsg.includes('same')) {
      toolHandlers.confirm_plot_grouping(session, {
        activityId: conflict.activityId,
        sameWork: true
      });
      session.pendingGroupConflict = null;
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Grouped activity confirmed. Running validation...`);
      return handleIncomingMessage(from, " ");
    } else if (lowerMsg === 'no' || lowerMsg === 'n' || lowerMsg.includes('different') || lowerMsg.includes('separate')) {
      toolHandlers.confirm_plot_grouping(session, {
        activityId: conflict.activityId,
        sameWork: false
      });
      session.pendingGroupConflict = null;
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Split into individual entries per plot.`);
      return handleIncomingMessage(from, " ");
    } else {
      await whatsappService.sendMessage(from, `Did you do the *same* work across all these plots (${conflict.plot_names.join(', ')})? (Please reply YES or NO)`);
      return;
    }
  }

  // 7. Deterministic Orchestration Pipeline
  try {
    // Refresh cache check (5-minute window)
    await refreshMetadataIfNeeded(session, false);

    // Intent Classification
    const intent = await classifyIntent(msg);
    console.log(`📱 [Intent] Classified as ${intent} for message: "${msg}"`);

    if (intent === 'HELP') {
      const activityList = ACTIVITY_TYPES.map(a => a.label).join(', ');
      await whatsappService.sendMessage(from, `I can help you report your daily tasks. You can report:\n${activityList}\n\nReply with what was done, or "reset" to start over.`);
      session.lastActivity = new Date().toISOString();
      await sessionService.setSession(from, session);
      return;
    }

    if (intent === 'REPORT_LOOKUP') {
      await whatsappService.sendMessage(from, "Historical query requested. To view details, please check the Admin Portal dashboard.");
      session.lastActivity = new Date().toISOString();
      await sessionService.setSession(from, session);
      return;
    }

    if (intent === 'GENERAL_QUERY') {
      // Conversational response fallback
      const followUpMsg = session.pending_clarification 
        ? `We are completing your report. ${session.pending_clarification.question}`
        : "How can I help you with your daily reporting? Send your tasks done today to continue.";
      await whatsappService.sendMessage(from, followUpMsg);
      session.lastActivity = new Date().toISOString();
      await sessionService.setSession(from, session);
      return;
    }

    if (intent === 'APPROVAL') {
      if (!session.awaiting_approval) {
        await whatsappService.sendMessage(from, "We are still collecting details. Please tell me what activities were done today.");
        return;
      }

      // Pre-submission refresh
      await refreshMetadataIfNeeded(session, true);

      // Guard check before submission
      const validation = await toolHandlers.validate_draft(session);
      if (!validation.valid) {
        const errorMsg = [...validation.tier1_errors, ...validation.tier2_errors].join('; ');
        await whatsappService.sendMessage(from, `Submission blocked. Validation failed: ${errorMsg}`);
        session.awaiting_approval = false;
        await sessionService.setSession(from, session);
        return;
      }

      // Hash Gating Check
      const currentHash = toolHandlers.computeReviewHash(session);
      if (currentHash !== session.review_metadata?.hash) {
        await whatsappService.sendMessage(from, "The report has changed. Generating updated review...");
        const reviewText = await toolHandlers.generate_review_summary(session);
        session.review_metadata = {
          hash: currentHash,
          generated_at: new Date().toISOString()
        };
        await sessionService.setSession(from, session);
        await whatsappService.sendMessage(from, reviewText.summary);
        return;
      }

      // Execute Submit
      await whatsappService.sendMessage(from, "Submitting report to Zetta Farms database...");
      try {
        const result = await toolHandlers.submit_dts(from, session);
        if (result.success) {
          if (session.pendingFarmsQueue && session.pendingFarmsQueue.length > 0) {
            const nextFarm = session.pendingFarmsQueue.shift();
            session.farmId = nextFarm.farm_id;
            session.farmCode = nextFarm.farm_code;
            session.farmName = nextFarm.farm_name;
            session.draft = { activities: [], meta: { deviation_notes: null, next_day_plans: null, agronomy_report: null } };
            session.review_metadata = null;
            session.awaiting_approval = false;
            session.submission_status = 'idle';
            session.submission_mode = 'draft';
            
            await refreshMetadataIfNeeded(session, true);
            
            if (session.dbCache.submission_id) {
              session.phase = 'DUPLICATE_CHECK';
              await sessionService.setSession(from, session);
              await whatsappService.sendMessage(from, `✅ Submitted! Next up is *${session.farmCode}* (${session.farmName}).\n\n⚠️ You have already submitted a report for this farm today.\n\nDo you want to *Check* it, *Amend* it, or *Overwrite* it?`);
            } else {
              session.phase = 'COLLECTING';
              await sessionService.setSession(from, session);
              const activityList = ACTIVITY_TYPES.map(a => a.label).join(', ');
              await whatsappService.sendMessage(from, `✅ Submitted! Now let's report for the next farm: *${session.farmCode}* (${session.farmName}). Please report activities:\n${activityList}`);
            }
          } else {
            await whatsappService.sendMessage(from, `✅ Submission successful! All task sheets saved. Have a good evening!`);
            await sessionService.deleteSession(from);
          }
          return;
        } else {
          await whatsappService.sendMessage(from, `❌ Submission failed: ${result.message}. You can reply "Yes" to try again.`);
        }
      } catch (err) {
        await whatsappService.sendMessage(from, `❌ Database write failed: ${err.message}. Keep your draft. You can reply "Yes" to retry.`);
      }
      return;
    }

    // 8. Pipeline: Extraction & Processing
    const extractedData = await openaiService.callExtraction(msg, session.dbCache);
    if (!extractedData) {
      await whatsappService.sendMessage(from, "Sorry, I couldn't extract details from that message. Please describe what activities were done.");
      return;
    }

    // Resolve entities deterministically
    if (extractedData.activities) {
      extractedData.activities = entityResolver.resolveEntities(extractedData.activities, session.dbCache);
    }

    // Process Correction Intent
    if (intent === 'CORRECTION') {
      const corrected = applyCorrection(session, extractedData);
      if (!corrected) {
        // If no context, treat as standard extraction update
        upsertDraftActivities(session, extractedData.activities || []);
      }
    } else {
      // Clarification resolution
      let clarificationResolved = false;
      if (session.pending_clarification) {
        clarificationResolved = resolveClarification(session, msg, extractedData);
      }

      if (!clarificationResolved) {
        // Standard report extraction
        upsertDraftActivities(session, extractedData.activities || []);
      }
    }

    // Upsert metadata
    if (extractedData.deviation_notes) session.draft.meta.deviation_notes = extractedData.deviation_notes;
    if (extractedData.next_day_plans) session.draft.meta.next_day_plans = extractedData.next_day_plans;
    if (extractedData.agronomy_report) session.draft.meta.agronomy_report = extractedData.agronomy_report;

    // Hard validation refresh
    await refreshMetadataIfNeeded(session, true);

    // Run Validation
    const validationResult = await toolHandlers.validate_draft(session);

    // Grouping checks check
    if (validationResult.grouping_checks && validationResult.grouping_checks.length > 0) {
      const groupingCheck = validationResult.grouping_checks[0];
      session.pendingGroupConflict = groupingCheck;
      await sessionService.setSession(from, session);
      
      const typeFriendly = groupingCheck.activity_type_name.replace(/_/g, ' ');
      await whatsappService.sendMessage(from, `Did you do the *same* ${typeFriendly} work across all these plots: ${groupingCheck.plot_names.join(', ')}? (Please reply YES or NO)`);
      return;
    }

    // Validation Resolution routing
    if (validationResult.valid) {
      // Valid! Move to review summary phase
      session.phase = 'REVIEW_PENDING';
      const reviewText = await toolHandlers.generate_review_summary(session);
      
      session.review_metadata = {
        hash: toolHandlers.computeReviewHash(session),
        generated_at: new Date().toISOString()
      };
      session.awaiting_approval = true;
      session.phase = 'AWAITING_APPROVAL';
      
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, reviewText.summary);
      
      if (validationResult.warnings && validationResult.warnings.length > 0) {
        let warningText = `⚠️ *Sanity Note:*\n` + validationResult.warnings.map(w => `• ${w}`).join('\n');
        await whatsappService.sendMessage(from, warningText);
      }
    } else {
      // Invalid draft. Ask single targeted clarification question.
      session.awaiting_approval = false;
      session.phase = 'CLARIFYING';
      
      if (validationResult.missing_fields && validationResult.missing_fields.length > 0) {
        const nextMissing = validationResult.missing_fields[0];
        const fieldLabel = entityResolver.resolvePlot ? entityResolver.resolveCrop ? "field" : "field" : "field"; // dummy check
        
        // Build question
        const question = await openaiService.callFollowUp(
          `activity type: ${nextMissing.type}, field: ${nextMissing.field}`,
          session.draft.activities,
          session.dbCache
        );

        session.pending_clarification = {
          activity_id: nextMissing.activityId,
          field: nextMissing.field,
          question,
          asked_at: new Date().toISOString()
        };
        
        await sessionService.setSession(from, session);
        await whatsappService.sendMessage(from, question);
      } else {
        // Validation failed due to database conflicts or structural errors, but no missing fields
        const errorMsg = [...validationResult.tier1_errors, ...validationResult.tier2_errors].join('\n• ');
        await whatsappService.sendMessage(from, `⚠️ Please correct the following errors:\n• ${errorMsg}`);
        await sessionService.setSession(from, session);
      }
    }

  } catch (err) {
    console.error('Orchestration loop error:', err);
    await whatsappService.sendMessage(from, "Sorry, I had trouble processing that report. Please try describing your tasks again.");
  }

  // Update timestamps and save session
  if (session) {
    session.lastActivity = new Date().toISOString();
    await sessionService.setSession(from, session);
  }
}

module.exports = { handleIncomingMessage };
