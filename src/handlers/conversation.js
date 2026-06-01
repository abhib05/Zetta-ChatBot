/**
 * Conversation Handler — State Router
 * Dispatches incoming messages to the correct step handler
 * based on the current session state.
 */
const sessionService = require('../services/session');
const whatsappService = require('../services/whatsapp');
const supabaseService = require('../services/supabase');

const { handleOnboarding } = require('./steps/onboarding');
const { handleFarmCode } = require('./steps/auth');
const { promptActivities, handleSelectActivities, handleActivityLoop } = require('./steps/activities');
const { handleMissingFields, handleConfirmConversion, handleDBOverwriteChoice, handleDBDeleteRecord } = require('./steps/parsing');
const { handleFinalReview, handleMoreActivities, handleConfirmDelete, handlePendingAuthorization, handleNoActivityReason } = require('./steps/review');

async function handleIncomingMessage(from, body) {
  if (!body || body.trim().length === 0) return;
  const msg = body.trim();

  let session = await sessionService.getSession(from);

  const lowerMsg = msg.toLowerCase();
  const RESTART_TRIGGERS = ['restart', 'reset', 'start over', 'start again', 'wrong info', 'cancel'];
  const wantsRestart = RESTART_TRIGGERS.some(t => lowerMsg === t || lowerMsg.startsWith(t + ' '));

  if (!session || wantsRestart) {
    if (session) {
      await sessionService.deleteSession(from);
    }

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

    const prefix = wantsRestart ? 'Session reset. ' : '';

    if (farms.length === 1) {
      const farm = farms[0];
      session.farmId = farm.farm_id;
      session.farmCode = farm.farm_code;
      session.farmName = farm.farm_name;

      const dbCache = await supabaseService.getFarmDetails(farm.farm_id);
      session.dbCache = dbCache;

      if (dbCache.plots.length === 0) {
        session.state = 'ONBOARDING_PLOTS';
        await sessionService.setSession(from, session);
        await whatsappService.sendMessage(from, `${prefix}Hey ${employeeInfo.employee_name}, ${farm.farm_code} is your farm code.\n\nWe need to set up your plots for ${farm.farm_name}.\n\nPlease reply with a list of your plots and their current crops (e.g. "A1 has Sugarcane, A2 has Cotton").`);
        return;
      }

      session.state = 'ASK_ACTIVITIES';
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, `${prefix}Hey ${employeeInfo.employee_name}, ${farm.farm_code} is your farm code.`);
      await promptActivities(from, session);
      return;
    } else {
      // Multiple farms assigned
      session.state = 'AWAITING_FARM_CODE';
      await sessionService.setSession(from, session);

      let msgText = `${prefix}Welcome back, *${employeeInfo.employee_name}*!\n\nYou have multiple farms assigned. Please reply with the Farm Code you are reporting for today:\n`;
      farms.forEach(f => {
        msgText += `\n- *${f.farm_code}* (${f.farm_name})`;
      });
      await whatsappService.sendMessage(from, msgText);
      return;
    }
  }

  // Timeout Check (5 minutes)
  if (session.lastActivity) {
    const timeSinceLastActivity = Date.now() - new Date(session.lastActivity).getTime();
    const FIVE_MINUTES = 5 * 60 * 1000;

    if (
      timeSinceLastActivity > FIVE_MINUTES && 
      session.state !== 'PENDING_AUTHORIZATION'
    ) {
      session.state = 'PENDING_AUTHORIZATION';
      await sessionService.setSession(from, session);
      await whatsappService.sendMessage(from, "Your previous session timed out due to 5 minutes of inactivity. Would you like to save and submit the activities you entered so far? (Reply YES to save, or NO to discard)");
      return;
    }
  }

  try {
    switch (session.state) {
      case 'ONBOARDING_PLOTS': return handleOnboarding(from, msg, session);
      case 'AWAITING_FARM_CODE': return handleFarmCode(from, msg, session);
      case 'ASK_ACTIVITIES': return handleSelectActivities(from, msg, session);
      case 'LOOP_ACTIVITIES': return handleActivityLoop(from, msg, session);
      case 'MISSING_FIELDS': return handleMissingFields(from, msg, session);
      case 'CONFIRM_CONVERSION': return handleConfirmConversion(from, msg, session);
      case 'CONFIRM_DB_OVERWRITE_CHOICE': return handleDBOverwriteChoice(from, msg, session);
      case 'CONFIRM_DB_DELETE_RECORD': return handleDBDeleteRecord(from, msg, session);
      case 'FINAL_REVIEW': return handleFinalReview(from, msg, session);
      case 'ASK_MORE_ACTIVITIES': return handleMoreActivities(from, msg, session);
      case 'ASK_NO_ACTIVITY_REASON': return handleNoActivityReason(from, msg, session);
      case 'CONFIRM_DELETE': return handleConfirmDelete(from, msg, session);
      case 'PENDING_AUTHORIZATION': return handlePendingAuthorization(from, msg, session);
      default:
        await sessionService.deleteSession(from);
        await whatsappService.sendMessage(from, "Session reset. Sending any message will restart your session.");
    }
  } catch (err) {
    console.error('Conversation Error:', err);
    await whatsappService.sendMessage(from, `Sorry, an error occurred. Please try again.`);
  }
}

module.exports = { handleIncomingMessage };
