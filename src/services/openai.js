const OpenAI = require('openai');
const config = require('../config');
const prompts = require('../llm/prompts');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  defaultHeaders: {
    'HTTP-Referer': 'https://zettafarms.com',
    'X-Title': 'Zetta Farm Chatbot',
  },
});

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

async function callExtraction(userMessage, dbCache) {
  let systemPrompt = prompts.EXTRACTION_SYSTEM_PROMPT;

  if (dbCache) {
    systemPrompt += `\n\nValid Plots for this farm: ${dbCache.plots.map(p => p.plot_code).join(', ')}
Valid Crops: ${dbCache.allCrops.map(c => c.crop_name).join(', ')}
Valid Machines: ${dbCache.machines.map(m => m.machine_name).join(', ')}`;
  }

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Extract data from: "${userMessage}"` }
    ],
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

async function callFollowUp(missingFieldLabel, draftState, dbCache) {
  let systemPrompt = prompts.FOLLOWUP_SYSTEM_PROMPT;

  if (dbCache) {
    systemPrompt += `\n\nFarm Context:
Plots: ${dbCache.plots.map(p => p.plot_code).join(', ')}
Crops: ${dbCache.allCrops.map(c => c.crop_name).join(', ')}`;
  }

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { 
        role: 'user', 
        content: `Target missing/invalid field: "${missingFieldLabel}"
Current draft state: ${JSON.stringify(draftState)}` 
      }
    ],
    temperature: 0.2
  }), 'followup');

  return response.choices[0].message.content.trim();
}

async function callReview(draftState, draftMeta, farmInfo) {
  const systemPrompt = prompts.REVIEW_SYSTEM_PROMPT;

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { 
        role: 'user', 
        content: `Farm Info: ${JSON.stringify(farmInfo)}
Draft Activities: ${JSON.stringify(draftState)}
Draft Metadata: ${JSON.stringify(draftMeta)}` 
      }
    ],
    temperature: 0.1
  }), 'review');

  return response.choices[0].message.content.trim();
}

module.exports = {
  callFarmSelection,
  callExtraction,
  callFollowUp,
  callReview
};
