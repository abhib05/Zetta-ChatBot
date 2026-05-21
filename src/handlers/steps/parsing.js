const sessionService = require('../../services/session');
const whatsappService = require('../../services/whatsapp');
const openaiService = require('../../services/openai');
const { ACTIVITY_TYPES, EXPECTED_DETAILS } = require('./constants');

function getReview() { return require('./review'); }

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

  await getReview().promptFinalReview(from);
}

module.exports = { runAIParsing, handleMissingFields, handleConfirmConversion, runAIValidation };
