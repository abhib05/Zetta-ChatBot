const sessionService = require('../../services/session');
const whatsappService = require('../../services/whatsapp');
const { ACTIVITY_TYPES } = require('./constants');
const { submitToDB } = require('./submission');

function getActivities() { return require('./activities'); }

const supabaseService = require('../../services/supabase');

async function handleFinalReview(from, msg, session) {
  const lower = msg.toLowerCase();
  if (lower.includes('yes') || lower.includes('y') || lower.includes('done')) {
    // Check for duplicates in DB before submitting
    const today = new Date().toISOString().split('T')[0];
    const duplicates = await supabaseService.checkDuplicateActivities(
      session.farmId, 
      today, 
      session.parsedJSON?.activities || []
    );

    if (duplicates && duplicates.length > 0) {
      session.state = 'CONFIRM_OVERWRITE';
      await sessionService.setSession(from, session);
      
      let text = `⚠️ You have already submitted the following activities for this farm today:\n`;
      duplicates.forEach(d => {
        text += `- ${d.activity_type_name || d.activity} on Plot ${d.plot_name || 'N/A'}\n`;
      });
      text += `\nDo you want to OVERWRITE the existing records with this new data? (Reply YES to overwrite, NO to cancel submission)`;
      
      return whatsappService.sendMessage(from, text);
    }

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
  await getActivities().askNextActivity(from, session);
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
    await getActivities().askNextActivity(from, session);
  } else {
    // Abort edit, go back to final review
    session.state = 'FINAL_REVIEW';
    await sessionService.setSession(from, session);
    await whatsappService.sendMessage(from, `Are you done? (Yes/No)`);
  }
}

async function handleConfirmOverwrite(from, msg, session) {
  const lower = msg.toLowerCase();
  if (lower.includes('yes') || lower.includes('y')) {
    // Proceed with overwrite
    await submitToDB(from, session);
  } else {
    // Cancel the entire submission
    await sessionService.deleteSession(from);
    await whatsappService.sendMessage(from, `Submission cancelled. Your previous records were kept intact. Please send your Employee Code if you'd like to start over.`);
  }
}

async function handlePendingAuthorization(from, msg, session) {
  const lower = msg.toLowerCase();
  if (lower.includes('yes') || lower.includes('y')) {
    // Attempt to submit whatever is collected so far
    if (session.parsedJSON && session.parsedJSON.activities && session.parsedJSON.activities.length > 0) {
      await submitToDB(from, session);
    } else {
      await sessionService.deleteSession(from);
      await whatsappService.sendMessage(from, `No activities were recorded to save. Session discarded. Please send your Employee Code to start a new report.`);
    }
  } else {
    // Discard
    await sessionService.deleteSession(from);
    await whatsappService.sendMessage(from, `Session discarded. Please send your Employee Code to start a new report.`);
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

async function promptFinalReview(from) {
  await whatsappService.sendMessage(from, `Are you done, or do you have more activities to report? (Reply Yes to submit, No to add more)`);
}

module.exports = { handleFinalReview, handleMoreActivities, handleConfirmDelete, handleConfirmOverwrite, handlePendingAuthorization, handleNoActivityReason, promptFinalReview };
