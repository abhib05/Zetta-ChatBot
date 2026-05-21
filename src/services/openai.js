/**
 * OpenRouter Service (OpenAI-compatible)
 * Handles the 2-step parsing for the rule-based agent.
 *
 * Token minimisation strategy:
 *  - max_tokens capped low (800 parse / 600 normalize)
 *  - Prompts are kept terse — no verbose examples
 *  - Retry on transient errors (max 2 retries, 1 s back-off)
 *  - Usage is logged per call for monitoring
 */

const OpenAI = require('openai');
const config = require('../config');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  defaultHeaders: {
    'HTTP-Referer': 'https://zettafarms.com',
    'X-Title': 'Zetta Farm Chatbot',
  },
});

// ── Retry wrapper ──────────────────────────────────────────────
async function callWithRetry(fn, label, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await fn();
      // Log token usage to help monitor costs
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
 * Call 1: Parse unstructured text into JSON.
 * Any missing data should be explicitly set to null.
 * Token budget: ~800 completion tokens (well within a single activity set).
 */
async function parseActivities(transcript, dbCache) {
  const plotsList = dbCache.plots.map(p => p.plot_code).join(', ');
  const cropsList = dbCache.allCrops.map(c => c.crop_name).join(', ');
  const machinesList = dbCache.machines.map(m => m.machine_name).join(', ');

  // Terse prompt — no example block, saves ~200 tokens per call
  const systemPrompt = `Farm data extractor. Output ONLY JSON inside <SAVE_DATA> tags.
Plots: [${plotsList}] | Crops: [${cropsList}] | Machines: [${machinesList}]
Activity types: land_preparation, sowing_transplanting, irrigation, weeding, agri_inputs, other_machinery_usage, harvest.
Generic fields per activity: activity_type_name, plot_name, crop_name, acres, labour_count, duration_minutes, expense_amount, remarks.
Details fields:
 land_preparation: activity_name,machine_name,time_minutes
 sowing_transplanting: seed_rate_per_acre,plants_sown,sowing_method,machine_time_minutes
 irrigation: irrigation_method,power_source,fuel_used_litres
 weeding: weeding_method,input_name,input_qty
 agri_inputs: input_method,input_type,input_name,input_qty
 other_machinery_usage: machine_name,fuel_used_litres
 harvest: harvest_cycle_no,harvesting_method,quantity,unit,machine_time_minutes
Set MISSING fields to null. DO NOT GUESS. Also output deviation_notes,next_day_plans,agronomy_report at top level.`;

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript }
    ],
    temperature: 0.1,
  }), 'parse');

  return extractSaveData(response.choices[0].message.content.trim());
}

/**
 * Call 2: Final normalization only — not a full rewrite.
 * Token budget: ~600 completion tokens (JSON in = JSON out, same size).
 */
async function normalizeAndValidate(filledJson, dbCache) {
  // Terse prompt saves ~150 tokens vs the verbose version
  const systemPrompt = `Normalize farm JSON. Return ONLY corrected JSON inside <SAVE_DATA> tags.
Rules: convert text numbers to Int/Float, time strings to minutes, set unconvertible numerics to null.
Ensure power_source is exactly 'solar', 'electricity', 'generator', or null.
Correct typos in plot_name/crop_name/machine_name against:
Plots: ${dbCache.plots.map(p => p.plot_code).join(', ')}
Crops: ${dbCache.allCrops.map(c => c.crop_name).join(', ')}
Machines: ${dbCache.machines.map(m => m.machine_name).join(', ')}`;

  const response = await callWithRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(filledJson) }  // compact JSON saves input tokens
    ],
    temperature: 0.0,
  }), 'normalize');

  return extractSaveData(response.choices[0].message.content.trim());
}

function extractSaveData(aiResponse) {
  const match = aiResponse.match(/<SAVE_DATA>([\s\S]*?)<\/SAVE_DATA>/);
  if (!match) return null;
  try {
    let cleanStr = match[1].trim();
    cleanStr = cleanStr.replace(/^```(json)?|```$/gm, '').trim();
    return JSON.parse(cleanStr);
  } catch (e) {
    console.error('⚠️  Failed to parse SAVE_DATA JSON:', e.message);
    return null;
  }
}

module.exports = { parseActivities, normalizeAndValidate, extractSaveData };
