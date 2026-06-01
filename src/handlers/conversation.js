/**
 * Conversation Handler — LLM-First State Orchestration Loop
 * 
 * Handles incoming WhatsApp messages, manages sessions, and routes to OpenAI tool-calling.
 */

const sessionService = require('../services/session');
const whatsappService = require('../services/whatsapp');
const supabaseService = require('../services/supabase');
const openaiService = require('../services/openai');
const toolHandlers = require('../llm/toolHandlers');

async function handleIncomingMessage(from, body) {
  if (!body || body.trim().length === 0) return;
  const msg = body.trim();
  const lowerMsg = msg.toLowerCase();

  // 1. Check restart triggers
  const RESTART_TRIGGERS = ['restart', 'reset', 'start over', 'start again', 'wrong info', 'cancel'];
  const wantsRestart = RESTART_TRIGGERS.some(t => lowerMsg === t || lowerMsg.startsWith(t + ' '));

  let session = await sessionService.getSession(from);

  if (wantsRestart && session) {
    await sessionService.deleteSession(from);
    session = null;
    await whatsappService.sendMessage(from, "Session reset. Send any message to start a new report.");
    return;
  }

  // 2. Programmatic Employee Authentication & Authorization
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

    // Initialize session structure
    session = await sessionService.createSession(from);
    session.employeeId = employeeInfo.employee_id;
    session.employeeName = employeeInfo.employee_name;
    session.employeeCode = employeeInfo.employee_code;

    if (farms.length === 1) {
      // Single farm assigned — proceed immediately
      const farm = farms[0];
      session.farmId = farm.farm_id;
      session.farmCode = farm.farm_code;
      session.farmName = farm.farm_name;
      session.dbCache = await supabaseService.getFarmDetails(farm.farm_id);
      session.conversationPhase = 'COLLECTING';
      
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Hey ${session.employeeName}, ${session.farmCode} is your farm code. Let's start your report. Please tell me what activities were done today.`);
      return;
    } else {
      // Multiple farms assigned — enter farm selection phase
      session.conversationPhase = 'FARM_SELECTION';
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

  // 3. 5-Minute Inactivity Timeout Check
  if (session.lastActivity) {
    const timeSinceLastActivity = Date.now() - new Date(session.lastActivity).getTime();
    const FIVE_MINUTES = 5 * 60 * 1000;

    if (timeSinceLastActivity > FIVE_MINUTES && !session.pendingTimeoutChoice) {
      session.pendingTimeoutChoice = true;
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, "Your previous session timed out. Would you like to resume your previous report, or start a new report? (Reply Resume / New)");
      return;
    }
  }

  // 4. Handle Timeout Choice
  if (session.pendingTimeoutChoice) {
    if (lowerMsg.includes('resume') || lowerMsg === 'yes' || lowerMsg === 'y' || lowerMsg.includes('continue') || lowerMsg.includes('proceed')) {
      session.pendingTimeoutChoice = false;
      session.lastActivity = new Date().toISOString();
      await sessionService.setSession(from, session);

      const reviewRes = await toolHandlers.generate_review_summary(session);
      await whatsappService.sendMessage(from, `Resumed previous report. Here is the summary of what we collected so far:\n\n${reviewRes.summary}\n\nLet's continue. Please tell me if you have any updates or changes.`);
      return;
    } else if (lowerMsg.includes('new') || lowerMsg === 'no' || lowerMsg === 'n' || lowerMsg.includes('start over')) {
      await sessionService.deleteSession(from);
      await whatsappService.sendMessage(from, "Starting a new report.");
      // Re-trigger auth for new session
      return handleIncomingMessage(from, body);
    } else {
      await whatsappService.sendMessage(from, "Please reply *Resume* to continue your previous report, or *New* to start a new one.");
      return;
    }
  }

  // 5. Handle Farm Selection Phase (Multi-Farm Routing)
  if (session.conversationPhase === 'FARM_SELECTION') {
    const matchedFarms = [];
    const textUpper = msg.toUpperCase();

    // Match by code/name
    session.availableFarms.forEach(f => {
      const code = f.farm_code.toUpperCase();
      const name = f.farm_name.toUpperCase();
      if (textUpper.includes(code) || textUpper.includes(name)) {
        matchedFarms.push(f);
      }
    });

    // Fallback: match index numbers
    const numberMatches = textUpper.match(/\b\d+\b/g);
    if (numberMatches && matchedFarms.length === 0) {
      numberMatches.forEach(numStr => {
        const idx = parseInt(numStr) - 1;
        if (idx >= 0 && idx < session.availableFarms.length) {
          const farm = session.availableFarms[idx];
          if (!matchedFarms.some(f => f.farm_id === farm.farm_id)) {
            matchedFarms.push(farm);
          }
        }
      });
    }

    if (matchedFarms.length === 0) {
      let errorMsg = `Could not match any farm code. Please reply with one or more of the assigned Farm Codes:\n`;
      session.availableFarms.forEach((f, idx) => {
        errorMsg += `\n${idx + 1}. *${f.farm_code}* (${f.farm_name})`;
      });
      await whatsappService.sendMessage(from, errorMsg);
      return;
    }

    // Set first farm as active, queue the rest
    const activeFarm = matchedFarms[0];
    session.farmId = activeFarm.farm_id;
    session.farmCode = activeFarm.farm_code;
    session.farmName = activeFarm.farm_name;
    session.dbCache = await supabaseService.getFarmDetails(activeFarm.farm_id);
    session.conversationPhase = 'COLLECTING';

    if (matchedFarms.length > 1) {
      session.pendingFarmsQueue = matchedFarms.slice(1);
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Got it. Let's go one at a time!\nStarting with *${session.farmCode}* (${session.farmName}) first. Please report your activities.`);
      return;
    } else {
      session.pendingFarmsQueue = [];
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Got it. Reporting for *${session.farmCode}* (${session.farmName}) today. Please report your activities.`);
      return;
    }
  }

  // 6. Handle Plot Grouping Confirmation (Yes/No if multiple plots were entered)
  if (session.pendingGroupConflict) {
    const conflict = session.pendingGroupConflict;
    if (lowerMsg === 'yes' || lowerMsg === 'y' || lowerMsg.includes('same')) {
      toolHandlers.confirm_plot_grouping(session, {
        activityId: conflict.activityId,
        sameWork: true
      });
      session.pendingGroupConflict = null;
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Understood. Grouped activity for ${conflict.plots.join(', ')} confirmed. Let's continue.`);
      // Re-trigger loop with empty text to run validator
      return handleIncomingMessage(from, " ");
    } else if (lowerMsg === 'no' || lowerMsg === 'n' || lowerMsg.includes('different') || lowerMsg.includes('separate')) {
      toolHandlers.confirm_plot_grouping(session, {
        activityId: conflict.activityId,
        sameWork: false
      });
      session.pendingGroupConflict = null;
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `Understood. Split into individual entries for each plot. Let's collect details one by one.`);
      // Re-trigger loop with empty text to run validator
      return handleIncomingMessage(from, " ");
    } else {
      await whatsappService.sendMessage(from, `Did you do the *same* work across all these plots (${conflict.plots.join(', ')})? (Please reply YES or NO)`);
      return;
    }
  }

  // 7. Core LLM Orchestrator Loop
  try {
    let loopCount = 0;
    let toolResults = [];
    let orchestratorResponse = null;

    // Loop to support multiple sequential tool calls in a single user message turn
    while (loopCount < 5) {
      orchestratorResponse = await openaiService.callOrchestrator(session, msg, toolResults);
      
      if (!orchestratorResponse.tool_calls || orchestratorResponse.tool_calls.length === 0) {
        break; // No tools to call, send response text
      }

      toolResults = []; // reset for this round of executions
      
      for (const tc of orchestratorResponse.tool_calls) {
        const { name, arguments: argsString } = tc.function;
        console.log(`🔧 LLM calling tool: ${name} with args: ${argsString}`);
        
        let args = {};
        try {
          args = JSON.parse(argsString);
        } catch (e) {
          console.error(`Failed to parse tool arguments: ${argsString}`);
        }

        // Execute tool handler (mutates session directly)
        let result;
        if (name === 'submit_dts') {
          result = await toolHandlers.submit_dts(from, session);
        } else if (name === 'validate_draft') {
          result = await toolHandlers.validate_draft(session);
        } else if (name === 'generate_review_summary') {
          result = await toolHandlers.generate_review_summary(session);
        } else if (name === 'confirm_plot_grouping') {
          result = toolHandlers.confirm_plot_grouping(session, args);
        } else if (name === 'add_draft_activity') {
          result = toolHandlers.add_draft_activity(session, args);
        } else if (name === 'update_draft_dts') {
          result = toolHandlers.update_draft_dts(session, args);
        } else if (name === 'remove_draft_activity') {
          result = toolHandlers.remove_draft_activity(session, args);
        } else if (name === 'clear_draft_fields') {
          result = toolHandlers.clear_draft_fields(session, args);
        } else {
          result = { error: `Tool ${name} not found.` };
        }

        toolResults.push({
          toolCall: tc,
          result
        });
      }

      loopCount++;
    }

    // 8. Handle Post-Execution State & Validation Check
    const validationResult = await toolHandlers.validate_draft(session);

    // If validation shows a grouping choice is pending, ask the user and yield
    if (validationResult.grouping_checks && validationResult.grouping_checks.length > 0) {
      const groupingCheck = validationResult.grouping_checks[0];
      session.pendingGroupConflict = groupingCheck;
      await sessionService.setSession(from, session);
      
      const typeFriendly = groupingCheck.activity_type_name.replace(/_/g, ' ');
      await whatsappService.sendMessage(from, `Did you do the *same* ${typeFriendly} work across all these plots: ${groupingCheck.plot_names.join(', ')}? (Please reply YES or NO)`);
      return;
    }

    // Determine phase changes based on submission/validation state
    if (session.confirmed_dts_state) {
      // DTS submitted successfully! Check if we have more queued farms
      if (session.pendingFarmsQueue && session.pendingFarmsQueue.length > 0) {
        const nextFarm = session.pendingFarmsQueue.shift();
        
        // Reset active farm context in the session
        session.farmId = nextFarm.farm_id;
        session.farmCode = nextFarm.farm_code;
        session.farmName = nextFarm.farm_name;
        session.dbCache = await supabaseService.getFarmDetails(nextFarm.farm_id);
        session.conversationPhase = 'COLLECTING';
        session.draft_dts_state = [];
        session.draft_meta = { deviation_notes: null, next_day_plans: null, agronomy_report: null };
        session.confirmed_dts_state = null;
        session.lastActivity = new Date().toISOString();

        await sessionService.setSession(from, session);
        await whatsappService.sendMessage(from, `ZF submission complete! Now let's report for the next queued farm: *${session.farmCode}* (${session.farmName}). Please report your activities for today.`);
        return;
      } else {
        // No more farms, session is cleaned up in toolHandlers.submit_dts/submission.js, return
        return;
      }
    }

    // If validation fails and there are missing fields, LLM can ask for them.
    // If validation passes and phase is still COLLECTING, the LLM should generate the review summary.
    if (validationResult.valid && session.conversationPhase === 'COLLECTING') {
      session.conversationPhase = 'REVIEW';
    } else if (!validationResult.valid && session.conversationPhase === 'REVIEW') {
      // If user corrected/removed something and it is now invalid, go back to collecting
      session.conversationPhase = 'COLLECTING';
    }

    // Update last activity timestamp and save updated session
    session.lastActivity = new Date().toISOString();
    await sessionService.setSession(from, session);

    // Send final generated message to WhatsApp
    if (orchestratorResponse && orchestratorResponse.message) {
      await whatsappService.sendMessage(from, orchestratorResponse.message);
    } else {
      // Fallback follow-up if LLM did not provide text response
      if (validationResult.missing_fields && validationResult.missing_fields.length > 0) {
        const followUpQuestion = await openaiService.callFollowUp(validationResult.missing_fields, session.draft_dts_state, session.dbCache);
        await whatsappService.sendMessage(from, followUpQuestion);
      } else if (session.conversationPhase === 'REVIEW') {
        const reviewRes = await toolHandlers.generate_review_summary(session);
        await whatsappService.sendMessage(from, reviewRes.summary);
        await whatsappService.sendMessage(from, `Please review the report above. Reply *Yes* to confirm and submit, or tell me what to edit.`);
      }
    }

  } catch (err) {
    console.error('Conversation Orchestration Error:', err);
    await whatsappService.sendMessage(from, `Sorry, an error occurred while processing your report. Please try again.`);
  }
}

module.exports = { handleIncomingMessage };
