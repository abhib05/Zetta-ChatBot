const whatsappService = require('../../services/whatsapp');
const supabaseService = require('../../services/supabase');
const sessionService = require('../../services/session');

function getActivities() { return require('./activities'); }

async function handleFarmCode(from, msg, session) {
  // Find if farm code matches
  const employeeInfo = await supabaseService.findEmployeeByPhone(from);
  if (!employeeInfo) {
    await whatsappService.sendMessage(from, "Error loading your employee profile. Please restart by sending cancel.");
    return;
  }

  const farms = employeeInfo.farms || [];
  const typedCode = msg.trim().toUpperCase();
  const selectedFarm = farms.find(f => f.farm_code.toUpperCase() === typedCode);

  if (!selectedFarm) {
    let errorMsg = `Invalid Farm Code. Please reply with one of the following assigned Farm Codes:\n`;
    farms.forEach(f => {
      errorMsg += `\n- *${f.farm_code}* (${f.farm_name})`;
    });
    await whatsappService.sendMessage(from, errorMsg);
    return;
  }

  // Set the selected farm in session
  session.farmId = selectedFarm.farm_id;
  session.farmCode = selectedFarm.farm_code;
  session.farmName = selectedFarm.farm_name;

  const dbCache = await supabaseService.getFarmDetails(selectedFarm.farm_id);
  session.dbCache = dbCache;

  if (dbCache.plots.length === 0) {
    session.state = 'ONBOARDING_PLOTS';
    await sessionService.setSession(from, session);
    await whatsappService.sendMessage(from, `Hey ${employeeInfo.employee_name}, ${selectedFarm.farm_code} is your farm code.\n\nWe need to set up your plots for ${selectedFarm.farm_name}.\n\nPlease reply with a list of your plots and their current crops (e.g. "A1 has Sugarcane, A2 has Cotton").`);
    return;
  }

  session.state = 'ASK_ACTIVITIES';
  await sessionService.setSession(from, session);
  await whatsappService.sendMessage(from, `Hey ${employeeInfo.employee_name}, ${selectedFarm.farm_code} is your farm code.`);
  await getActivities().promptActivities(from, session);
}

module.exports = { handleFarmCode };
