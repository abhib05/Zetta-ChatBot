/**
 * Conversation Handler — State Router
 * Dispatches incoming messages to the correct step handler
 * based on the current session state.
 */
const sessionService = require('../services/session');
const whatsappService = require('../services/whatsapp');

const { handleEmployeeCode, handleFarmCode } = require('./steps/auth');
const { handleOnboarding } = require('./steps/onboarding');
const { promptActivities, handleSelectActivities, handleActivityLoop } = require('./steps/activities');
const { handleMissingFields, handleConfirmConversion } = require('./steps/parsing');
const { handleFinalReview, handleMoreActivities, handleConfirmDelete, handleNoActivityReason } = require('./steps/review');

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
      case 'AWAITING_EMPLOYEE_CODE': return handleEmployeeCode(from, msg, session);
      case 'AWAITING_FARM_CODE': return handleFarmCode(from, msg, session);
      case 'ONBOARDING_PLOTS': return handleOnboarding(from, msg, session);
      case 'ASK_ACTIVITIES': return handleSelectActivities(from, msg, session);
      case 'LOOP_ACTIVITIES': return handleActivityLoop(from, msg, session);
      case 'MISSING_FIELDS': return handleMissingFields(from, msg, session);
      case 'CONFIRM_CONVERSION': return handleConfirmConversion(from, msg, session);
      case 'FINAL_REVIEW': return handleFinalReview(from, msg, session);
      case 'ASK_MORE_ACTIVITIES': return handleMoreActivities(from, msg, session);
      case 'ASK_NO_ACTIVITY_REASON': return handleNoActivityReason(from, msg, session);
      case 'CONFIRM_DELETE': return handleConfirmDelete(from, msg, session);
      default:
        await sessionService.deleteSession(from);
        await whatsappService.sendMessage(from, "Session reset. Please send your Employee Code.");
    }
  } catch (err) {
    console.error('Conversation Error:', err);
    await whatsappService.sendMessage(from, `Sorry, an error occurred. Please try again.`);
  }
}

module.exports = { handleIncomingMessage };
