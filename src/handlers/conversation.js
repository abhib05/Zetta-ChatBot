/**
 * Conversation Handler
 * Central state machine that drives the entire farmer ↔ bot interaction.
 *
 * States:
 *   AWAITING_FARM_CODE  →  COLLECTING_DATA  →  COMPLETED
 *
 * Handles 600+ concurrent sessions safely via Redis-backed state.
 */

const sessionService = require('../services/session');
const whatsappService = require('../services/whatsapp');
const openaiService = require('../services/openai');
const supabaseService = require('../services/supabase');
const config = require('../config');

// ─────────────────────────────────────────────
// STATIC MESSAGES
// ─────────────────────────────────────────────

const MSG_GREETING = `Welcome to Zetta Farms Daily Reporting!

Please send your Farm Code to begin.
Example: ZF-001`;

const MSG_INVALID_CODE = `That farm code was not found. Please check and try again.

Your code should look like: ZF-001`;

const MSG_ERROR = `Sorry, something went wrong. Please try again in a moment. If this keeps happening, contact your supervisor.`;

const MSG_DUPLICATE_WARNING = (existingTime) =>
  `Note: A DTS for your farm was already submitted today at ${existingTime}. This will add a new entry. Continue? (yes/no)`;

// ─────────────────────────────────────────────
// MAIN ENTRY POINT
// Called by the webhook for every incoming message.
// ─────────────────────────────────────────────

async function handleIncomingMessage(from, body) {
  // Guard: ignore empty messages
  if (!body || body.trim().length === 0) return;

  let session = await sessionService.getSession(from);

  // ── Brand new conversation ──────────────────
  if (!session) {
    session = await sessionService.createSession(from);
    await whatsappService.sendMessage(from, MSG_GREETING);
    return;
  }

  // ── Route based on current state ───────────
  switch (session.state) {
    case 'AWAITING_FARM_CODE':
      await handleFarmCode(from, body.trim(), session);
      break;

    case 'AWAITING_DUPLICATE_CONFIRM':
      await handleDuplicateConfirm(from, body.trim(), session);
      break;

    case 'COLLECTING_DATA':
      await handleDataCollection(from, body.trim(), session);
      break;

    case 'COMPLETED':
      // They're messaging again after completing — start fresh
      await sessionService.deleteSession(from);
      const newSession = await sessionService.createSession(from);
      await whatsappService.sendMessage(from, MSG_GREETING);
      break;

    default:
      await sessionService.deleteSession(from);
      await sessionService.createSession(from);
      await whatsappService.sendMessage(from, MSG_GREETING);
  }
}

// ─────────────────────────────────────────────
// STATE: AWAITING_FARM_CODE
// ─────────────────────────────────────────────

async function handleFarmCode(from, input, session) {
  const farmCode = input.toUpperCase().replace(/\s/g, '');

  const farm = await supabaseService.validateFarmCode(farmCode);

  if (!farm) {
    await whatsappService.sendMessage(from, MSG_INVALID_CODE);
    return;
  }

  // Check for duplicate submission today
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const today = new Date(Date.now() + istOffsetMs).toISOString().split('T')[0];
  const existing = await supabaseService.checkDuplicateSubmission(farmCode, today);

  if (existing) {
    const time = new Date(existing.submitted_at).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit',
    });
    session.pendingFarmCode = farmCode;
    session.pendingFarmName = farm.farm_name;
    session.state = 'AWAITING_DUPLICATE_CONFIRM';
    await sessionService.setSession(from, session);
    await whatsappService.sendMessage(from, MSG_DUPLICATE_WARNING(time));
    return;
  }

  await activateFarmSession(from, session, farm);
}

// ─────────────────────────────────────────────
// STATE: AWAITING_DUPLICATE_CONFIRM
// ─────────────────────────────────────────────

async function handleDuplicateConfirm(from, input, session) {
  const lower = input.toLowerCase();
  if (lower.includes('yes') || lower.includes('y') || lower.includes('ok') || lower.includes('haan')) {
    // Proceed with duplicate farm code
    const farm = { farm_code: session.pendingFarmCode, farm_name: session.pendingFarmName };
    await activateFarmSession(from, session, farm);
  } else {
    await whatsappService.sendMessage(from, `Okay, submission cancelled. Send your Farm Code again when you are ready.`);
    session.state = 'AWAITING_FARM_CODE';
    session.pendingFarmCode = null;
    session.pendingFarmName = null;
    await sessionService.setSession(from, session);
  }
}

// ─────────────────────────────────────────────
// Helper: Activate farm session → start collecting
// ─────────────────────────────────────────────

async function activateFarmSession(from, session, farm) {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const today = new Date(Date.now() + istOffsetMs).toISOString().split('T')[0];
  const greeting = getTimeGreeting();

  session.state = 'COLLECTING_DATA';
  session.farmCode = farm.farm_code;
  session.farmName = farm.farm_name;
  session.date = today;
  session.conversationId = `${farm.farm_code}-${Date.now()}`;
  session.conversationHistory = [];
  session.turnCount = 0;

  await sessionService.setSession(from, session);

  const welcomeMsg =
    `Farm verified: ${farm.farm_name} (${farm.farm_code})` +
    `\n\nGood ${greeting}! Tell me what activities were carried out on the farm today.`;

  await whatsappService.sendMessage(from, welcomeMsg);
}

// ─────────────────────────────────────────────
// STATE: COLLECTING_DATA
// Core conversation loop powered by GPT-4
// ─────────────────────────────────────────────

async function handleDataCollection(from, message, session) {
  try {
    // Increment turn counter
    session.turnCount = (session.turnCount || 0) + 1;

    // Detect manual exit phrases OR max turns
    const isExit = openaiService.isExitPhrase(message);
    const hitMaxTurns = session.turnCount > config.conversation.maxTurns;

    // Build farm context for AI
    const farmCtx = {
      farmCode: session.farmCode,
      farmName: session.farmName,
      date: session.date,
    };

    if (isExit || hitMaxTurns) {
      if (hitMaxTurns) console.warn(`⚠️  Max turns reached for ${from}. Auto-saving.`);
      await whatsappService.sendMessage(from, `Saving your report now, please wait...`);
      
      const finalPrompt = "The user has completed the report. Please output the final <SAVE_DATA> block now with all observed details.";
      const historyWindow = session.conversationHistory.slice(-20);
      
      const aiRaw = await openaiService.processMessage(historyWindow, finalPrompt, farmCtx);
      const saveData = openaiService.extractSaveData(aiRaw);
      
      await sessionService.setSession(from, session);
      await handleSubmission(from, session, saveData || session.collectedData);
      return;
    }

    // Add farmer's message to history
    session.conversationHistory.push({ role: 'user', content: message });

    // Keep only the last 20 turns in history to control token usage
    const historyWindow = session.conversationHistory.slice(-20);

    // Get AI response
    const aiRaw = await openaiService.processMessage(historyWindow, message, farmCtx);

    // Check if AI has decided to save
    const saveData = openaiService.extractSaveData(aiRaw);
    const aiMessage = openaiService.cleanResponse(aiRaw);

    // Add AI response to history (without the SAVE_DATA block)
    session.conversationHistory.push({ role: 'assistant', content: aiMessage });

    if (saveData) {
      // AI has collected enough and wants to save
      await sessionService.setSession(from, session);
      await handleSubmission(from, session, saveData);
      return;
    }

    // Continue conversation
    await sessionService.setSession(from, session);
    await whatsappService.sendMessage(from, aiMessage);

  } catch (err) {
    console.error(`❌ Data collection error for ${from}:`, err.message);
    // Save session even on error so we don't lose data
    await sessionService.setSession(from, session).catch(() => {});
    await whatsappService.sendMessage(from, MSG_ERROR);
  }
}

// ─────────────────────────────────────────────
// SUBMIT: Save to Supabase
// ─────────────────────────────────────────────

async function handleSubmission(from, session, saveData) {
  try {
    // Merge AI-extracted data with session's collected data
    const finalData = saveData || session.collectedData;

    const submissionPayload = {
      farmCode: session.farmCode,
      date: session.date || new Date().toISOString().split('T')[0],
      filledBy: finalData.filledBy || null,
      reasonsForDeviation: finalData.reasonsForDeviation || null,
      nextDayPlans: finalData.nextDayPlans || null,
      agronomyReport: finalData.agronomyReport || null,
      machineryUsage: finalData.machineryUsage || [],
      harvest: finalData.harvest || [],
      whatsappNumber: from,
      conversationId: session.conversationId,
    };

    const saved = await supabaseService.saveDTSSubmission(submissionPayload);

    // Build a brief summary for the confirmation message
    const machCount = submissionPayload.machineryUsage.length;
    const harvCount = submissionPayload.harvest.length;
    const refId = saved.id.slice(0, 8).toUpperCase();

    const confirmMsg =
      `Daily Task Sheet Submitted!` +
      `\n\nFarm: ${session.farmName}` +
      `\nDate: ${new Date(session.date).toLocaleDateString('en-IN')}` +
      `\nMachinery entries: ${machCount}` +
      `\nHarvest entries: ${harvCount}` +
      `\nReference ID: ${refId}` +
      `\n\nThank you! Have a good evening.`;

    await whatsappService.sendMessage(from, confirmMsg);

    // Mark session done (kept in Redis for 1 hour so re-messages start fresh)
    session.state = 'COMPLETED';
    session.submissionId = saved.id;
    await sessionService.setSession(from, session);

  } catch (err) {
    console.error(`❌ Submission error for ${from}:`, err.message);
    await whatsappService.sendMessage(
      from,
      `Sorry, there was an error saving your report (${err.message}). Please contact your supervisor with your farm code: ${session.farmCode}`
    );
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getTimeGreeting() {
  const h = new Date().getUTCHours() + 5.5; // IST offset
  const hour = Math.floor(h) % 24;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

module.exports = { handleIncomingMessage };
