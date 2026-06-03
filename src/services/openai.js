/**
 * OpenAI Service — Tool-Calling & Layer Handlers
 * 
 * Handles all AI interactions for the DTS chatbot.
 * Integrates the five prompt locations defined in `src/llm/prompts.js`.
 */

const OpenAI = require('openai');
const config = require('../config');
const prompts = require('../llm/prompts');
const { TOOLS } = require('../llm/tools');
const { buildSchemaContext, getFieldLabel } = require('../config/activitySchema');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  defaultHeaders: {
    'HTTP-Referer': 'https://zettafarms.com',
    'X-Title': 'Zetta Farm Chatbot',
  },
});

// Retry wrapper for transient API errors
async function callWithRetry(fn, label, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await fn();
      if (response.usage) {
        console.log(`[OpenAI:${label}] tokens — prompt:${response.usage.prompt_tokens} completion:${response.usage.completion_tokens} total:${response.usage.total_tokens}`);
      }
      return response;
    } catch (err) {
      const isRetryable = err.status === 429 || err.status >= 500;
      if (!isRetryable || attempt > maxRetries) throw err;
      console.warn(`[OpenAI:${label}] attempt ${attempt} failed (${err.status}), retrying in 1 s…`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

/**
 * Prompt Location 1: Call Orchestrator Layer
 * 
 * Manages the main conversation turn, decides whether to call tools
 * or reply to the user.
 */
async function callOrchestrator(session, userMessage, toolResults = []) {
  let systemPrompt = prompts.ORCHESTRATOR_SYSTEM_PROMPT || 
    `You are the Zetta Farms WhatsApp supervisor. Call tools to manage the user's daily task sheet (DTS) draft.
     Sanitized context:
     - Employee: ${session.employeeName} (${session.employeeCode})
     - Farm: ${session.farmName} (${session.farmCode})
     - Plots available: ${session.dbCache.plots.map(p => p.plot_code).join(', ')}
     - Crops available: ${session.dbCache.allCrops.map(c => c.crop_name).join(', ')}
     - Machines: ${session.dbCache.machines.map(m => m.machine_name).join(', ')}
     - Already submitted today: ${JSON.stringify(session.dbCache.submittedToday)}
     - Current draft state: ${JSON.stringify(session.draft_dts_state)}
     - Current phase: ${session.conversationPhase}`;

  if (prompts.ORCHESTRATOR_SYSTEM_PROMPT) {
    systemPrompt += `\n\nContext: Plots: ${session.dbCache.plots.map(p => p.plot_code).join(', ')} | Crops: ${session.dbCache.allCrops.map(c => c.crop_name).join(', ')} | Machines: ${session.dbCache.machines.map(m => m.machine_name).join(', ')} | Submitted Today: ${JSON.stringify(session.dbCache.submittedToday)}`;
  }

  // Inject central activity schema as the single source of truth for required fields
  const schemaContext = buildSchemaContext();
  systemPrompt += `\n\nActivity Required Fields Schema:\n${schemaContext}`;

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  // Append history/context (we pass the current state and latest message)
  // To keep it state-first, we provide the current draft and meta.
  messages.push({
    role: 'user',
    content: `State of draft DTS: ${JSON.stringify(session.draft_dts_state)}
              State of draft metadata: ${JSON.stringify(session.draft_meta)}
              Latest user message: "${userMessage}"`
  });

  // If there are tool results from this turn, feed them back to the LLM
  if (toolResults && toolResults.length > 0) {
    toolResults.forEach(tr => {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [tr.toolCall]
      });
      messages.push({
        role: 'tool',
        tool_call_id: tr.toolCall.id,
        content: JSON.stringify(tr.result)
      });
    });
  }

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    temperature: 0.1
  }), 'orchestrator');

  const choice = response.choices[0].message;
  return {
    message: choice.content,
    tool_calls: choice.tool_calls || null
  };
}

/**
 * Call Farm Selection Layer
 * Uses LLM to robustly understand which farms a user wants to report for.
 */
async function callFarmSelection(userMessage, availableFarms) {
  const systemPrompt = `You are an assistant that helps identify which farms a user wants to select from a list.
Available farms:
${availableFarms.map((f, i) => `${i + 1}. ${f.farm_code} (${f.farm_name})`).join('\n')}

User's message: "${userMessage}"

Return ONLY a JSON object with a single key "selected_farm_codes" containing an array of the farm codes that the user intends to select. If they mean all farms, return all farm codes. If none, return an empty array.
Example: {"selected_farm_codes": ["ZF-006", "ZF-007"]}`;

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt }
    ],
    temperature: 0.0,
    response_format: { type: 'json_object' }
  }), 'farm_selection');

  try {
    const res = JSON.parse(response.choices[0].message.content.trim());
    return res.selected_farm_codes || [];
  } catch (e) {
    console.error('Failed to parse farm selection response:', e);
    return [];
  }
}

/**
 * Prompt Location 2: Call Extraction Layer (Optional helper)
 */
async function callExtraction(userMessage, dbCache) {
  let systemPrompt = prompts.EXTRACTION_SYSTEM_PROMPT || 
    `Extract activities from the message. Output JSON.
     Plots: ${dbCache.plots.map(p => p.plot_code).join(', ')}
     Crops: ${dbCache.allCrops.map(c => c.crop_name).join(', ')}`;

  if (prompts.EXTRACTION_SYSTEM_PROMPT) {
    systemPrompt += `\n\nValid Plots: ${dbCache.plots.map(p => p.plot_code).join(', ')} | Crops: ${dbCache.allCrops.map(c => c.crop_name).join(', ')}`;
  }

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: 3000,
    temperature: 0.0,
    response_format: { type: 'json_object' }
  }), 'extraction');

  try {
    return JSON.parse(response.choices[0].message.content.trim());
  } catch (e) {
    console.error('Failed to parse extraction response:', e);
    return null;
  }
}

/**
 * Prompt Location 3: Call Validation Layer LLM Hook
 */
async function callValidation(draftState, dbCache) {
  let systemPrompt = prompts.VALIDATION_SYSTEM_PROMPT || 
    `Validate the current DTS draft activities. Detect inconsistencies and return a JSON validation result.
     Output schema:
     {
       "valid": boolean,
       "errors": string[],
       "missing_fields": [{"activityId": string, "field": string}],
       "corrections": [{"activityId": string, "field": string, "suggested": any, "reason": string}]
     }
     Plots list: ${dbCache.plots.map(p => p.plot_code).join(', ')}
     Crops list: ${dbCache.allCrops.map(c => c.crop_name).join(', ')}`;

  if (prompts.VALIDATION_SYSTEM_PROMPT) {
    systemPrompt += `\n\nValid Plots: ${dbCache.plots.map(p => p.plot_code).join(', ')} | Crops: ${dbCache.allCrops.map(c => c.crop_name).join(', ')}`;
  }

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(draftState) }
    ],
    temperature: 0.0,
    response_format: { type: 'json_object' }
  }), 'validation');

  try {
    return JSON.parse(response.choices[0].message.content.trim());
  } catch (e) {
    console.error('Failed to parse validation response:', e);
    return null;
  }
}

/**
 * Prompt Location 4: Call Follow-Up Layer
 */
async function callFollowUp(missingFields, draftState, dbCache) {
  // Enrich missing fields with human-readable labels for the LLM
  const enrichedMissing = missingFields.map(mf => ({
    ...mf,
    fieldLabel: getFieldLabel(mf.type, mf.field)
  }));

  let systemPrompt = prompts.FOLLOWUP_SYSTEM_PROMPT || 
    `Ask the user a conversational question to collect the missing fields.
     Do not ask for fields that are already filled.
     Missing fields: ${JSON.stringify(enrichedMissing)}
     Current draft: ${JSON.stringify(draftState)}
     Farm metadata (plots/crops): ${dbCache ? JSON.stringify({ plots: dbCache.plots, crops: dbCache.allCrops }) : ''}`;

  if (prompts.FOLLOWUP_SYSTEM_PROMPT && dbCache) {
    systemPrompt += `\n\nValid Plots: ${dbCache.plots.map(p => p.plot_code).join(', ')} | Crops: ${dbCache.allCrops.map(c => c.crop_name).join(', ')}`;
  }

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate follow-up question.' }
    ],
    temperature: 0.3
  }), 'followup');

  return response.choices[0].message.content.trim();
}

/**
 * Prompt Location 5: Call Review Layer
 */
async function callReview(draftState, draftMeta, farmInfo) {
  let systemPrompt = prompts.REVIEW_SYSTEM_PROMPT || 
    `Generate a summary report of the DTS submission for the farmer to review and confirm.
     Farm details: ${JSON.stringify(farmInfo)}
     Draft metadata: ${JSON.stringify(draftMeta)}`;

  if (prompts.REVIEW_SYSTEM_PROMPT) {
    systemPrompt += `\n\nFarm details: ${JSON.stringify(farmInfo)}\nDraft metadata: ${JSON.stringify(draftMeta)}`;
  }

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(draftState) }
    ],
    temperature: 0.2
  }), 'review');

  return response.choices[0].message.content.trim();
}

module.exports = {
  callOrchestrator,
  callFarmSelection,
  callExtraction,
  callValidation,
  callFollowUp,
  callReview
};
