const sessionService = require('../../services/session');
const whatsappService = require('../../services/whatsapp');
const { ACTIVITY_TYPES } = require('./constants');

function getParsing() { return require('./parsing'); }

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

async function askNextActivity(from, session) {
  if (session.currentActivityIndex >= session.selectedActivities.length) {
    // All activities answered! Call LLM 1
    return getParsing().runAIParsing(from, session);
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

module.exports = { promptActivities, handleSelectActivities, askNextActivity, handleActivityLoop };
