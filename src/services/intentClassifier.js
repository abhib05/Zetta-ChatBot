const OpenAI = require('openai');
const config = require('../config');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  defaultHeaders: {
    'HTTP-Referer': 'https://zettafarms.com',
    'X-Title': 'Zetta Farm Chatbot',
  },
});

async function classifyIntent(userMessage) {
  const systemPrompt = `You are a WhatsApp intent classifier for Zetta Farms. Your job is to classify the user's message into one of the following intents:
- REPORTING: Providing new report data, describing tasks done today (e.g. "We prepared plot A1", "sowing done on 5 acres").
- CORRECTION: Editing, disputing, or correcting previous input or a draft activity (e.g. "not A1", "change labour to 5", "tractor was TR02", "same for A3", "no, change that to sugarcane").
- APPROVAL: Confirming, approving, or agreeing to submit a report (e.g. "yes", "confirm", "ok", "looks good", "correct").
- HELP: Asking for instructions or how to use the bot (e.g. "how do I use this", "help").
- REPORT_LOOKUP: Requesting info about historical reports, yesterday's report, or current state of plots/crops (e.g. "what crop is on A1", "show yesterday report", "show last report").
- GENERAL_QUERY: Greetings, manager queries, or other general conversation (e.g. "hi", "who is the manager", "thanks").

Output JSON format:
{
  "intent": "REPORTING" | "CORRECTION" | "APPROVAL" | "HELP" | "REPORT_LOOKUP" | "GENERAL_QUERY",
  "reason": "short explanation"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Message: "${userMessage}"` }
      ],
      temperature: 0.0,
      response_format: { type: 'json_object' }
    });

    const res = JSON.parse(response.choices[0].message.content.trim());
    return res.intent || 'GENERAL_QUERY';
  } catch (err) {
    console.error('Intent classification failed, defaulting to REPORTING:', err);
    const lower = userMessage.toLowerCase().trim();
    if (['yes', 'y', 'confirm', 'ok', 'correct', 'looks good'].includes(lower)) return 'APPROVAL';
    if (['help', 'info'].includes(lower)) return 'HELP';
    return 'REPORTING';
  }
}

module.exports = { classifyIntent };
