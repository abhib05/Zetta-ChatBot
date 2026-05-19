/**
 * OpenRouter Service (OpenAI-compatible)
 * Handles the 2-step parsing for the rule-based agent.
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

/**
 * Call 1: Parse unstructured text into JSON.
 * Any missing data should be explicitly set to null.
 */
async function parseActivities(transcript, dbCache) {
  const plotsList = dbCache.plots.map(p => p.plot_code).join(', ');
  const cropsList = dbCache.allCrops.map(c => c.crop_name).join(', ');
  const machinesList = dbCache.machines.map(m => m.machine_name).join(', ');

  const systemPrompt = `You are a strict data extraction AI for a Farm Management System.
The user has provided a transcript of their farm activities. Extract this into a structured JSON array.

Valid Plots for this farm: [${plotsList}]
Valid Crops in system: [${cropsList}]
Valid Machines in system: [${machinesList}]

Map the activities to exactly these 7 types:
1. land_preparation
2. sowing_transplanting
3. irrigation
4. weeding
5. agri_inputs
6. other_machinery_usage
7. harvest

For each activity, fill out the generic fields (plot_name, crop_name, acres, labour_count, duration_minutes, expense_amount, remarks).
If a field is not mentioned, set it to null. DO NOT GUESS.

Also fill out the "details" object specifically for that activity type based on the schema:
- land_preparation: activity_name, machine_name, time_minutes
- sowing_transplanting: seed_rate_per_acre, plants_sown, sowing_method, machine_time_minutes
- irrigation: irrigation_method, power_source, fuel_used_litres
- weeding: weeding_method, input_name, input_qty
- agri_inputs: input_method, input_type, input_name, input_qty
- other_machinery_usage: machine_name, fuel_used_litres
- harvest: harvest_cycle_no, harvesting_method, quantity, unit, machine_time_minutes

Return ONLY valid JSON wrapped in <SAVE_DATA> tags.
Format:
<SAVE_DATA>
{
  "activities": [
    {
      "activity_type_name": "weeding",
      "plot_name": "Plot A1",
      "crop_name": "Sugarcane",
      "acres": 1.5,
      "labour_count": null,
      ...
      "details": { ... }
    }
  ],
  "deviation_notes": null,
  "next_day_plans": null,
  "agronomy_report": null,
  "filled_by": null
}
</SAVE_DATA>`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `TRANSCRIPT:\n${transcript}` }
  ];

  const response = await openai.chat.completions.create({
    model: config.openai.model,
    messages,
    max_tokens: 1500,
    temperature: 0.1,
  });

  return extractSaveData(response.choices[0].message.content.trim());
}

/**
 * Call 2: Final validation & normalization.
 * Takes the JSON (which might have raw text strings injected by the rule-based agent for missing fields)
 * and normalizes all fields to strict Database types (Integers, Numerics).
 */
async function normalizeAndValidate(filledJson, dbCache) {
  const systemPrompt = `You are a strict database normalizer.
The provided JSON contains farm data. Some fields may contain raw strings like "3 hours" instead of integers, or "five" instead of 5, or typos in plot names.

Your task is to:
1. Normalize all numeric fields (acres, labour_count, duration_minutes, expense_amount, quantities) to strict Integers or Floats.
2. Normalize all time-related fields to total minutes (e.g., "2 hours" -> 120).
3. Ensure no numeric fields contain text. If a value cannot be converted, set it to null.
4. Correct any minor typos in plot_name, crop_name, or machine_name to match the exact string formats provided below.

Valid Plots: ${dbCache.plots.map(p => p.plot_code).join(', ')}
Valid Crops: ${dbCache.allCrops.map(c => c.crop_name).join(', ')}
Valid Machines: ${dbCache.machines.map(m => m.machine_name).join(', ')}

Return the perfectly normalized JSON wrapped in <SAVE_DATA> tags.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(filledJson, null, 2) }
  ];

  const response = await openai.chat.completions.create({
    model: config.openai.model,
    messages,
    max_tokens: 1500,
    temperature: 0.0,
  });

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
