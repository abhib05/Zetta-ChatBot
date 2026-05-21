const whatsappService = require('../../services/whatsapp');
const supabaseService = require('../../services/supabase');

function getActivities() { return require('./activities'); }

async function handleOnboarding(from, msg, session) {
  // A simple heuristic for parsing "A1 sugarcane, A2 wheat"
  // For production, a 1-shot LLM call is better, but doing simple split here:
  const parts = msg.split(',').map(s => s.trim());
  const plotsData = [];
  
  for (const part of parts) {
    const tokens = part.split(/\s+/);
    if (tokens.length >= 2) {
      plotsData.push({ plot_code: tokens[0], crop_name: tokens[tokens.length - 1] });
    }
  }

  if (plotsData.length === 0) {
    return whatsappService.sendMessage(from, `Could not understand the plots. Please use format: "A1 Sugarcane, A2 Cotton"`);
  }

  await supabaseService.saveFarmOnboarding(session.farmId, plotsData);
  
  // Refresh cache
  session.dbCache = await supabaseService.getFarmDetails(session.farmId);
  
  await whatsappService.sendMessage(from, `Great! Saved ${plotsData.length} plots.`);
  await getActivities().promptActivities(from, session);
}

module.exports = { handleOnboarding };
