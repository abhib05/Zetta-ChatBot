const sessionService = require('../../services/session');
const whatsappService = require('../../services/whatsapp');
const supabaseService = require('../../services/supabase');

function getActivities() { return require('./activities'); }

async function handleEmployeeCode(from, msg, session) {
  const code = msg.trim();
  const employee = await supabaseService.validateEmployeeCode(code);

  if (!employee) {
    return whatsappService.sendMessage(from, `Employee code not found or inactive. Try again:`);
  }

  session.employeeId = employee.employee_id;
  session.employeeName = employee.employee_name;
  session.employeeCode = employee.employee_code;
  session.state = 'AWAITING_FARM_CODE';
  await sessionService.setSession(from, session);

  await whatsappService.sendMessage(from, `Welcome ${employee.employee_name}!\n\nPlease send the Farm Code you are reporting for (e.g. ZF-001).`);
}

async function handleFarmCode(from, msg, session) {
  const code = msg.toUpperCase();
  const farm = await supabaseService.validateEmployeeFarmAccess(session.employeeId, code);

  if (!farm) {
    return whatsappService.sendMessage(from, `Farm code not found or you are not authorized for this farm. Try again:`);
  }

  session.farmId = farm.farm_id;
  session.farmCode = farm.farm_code;
  session.farmName = farm.farm_name;

  const dbCache = await supabaseService.getFarmDetails(farm.farm_id);
  session.dbCache = dbCache;

  // Step 2 Branching: If no plots exist, do onboarding
  if (dbCache.plots.length === 0) {
    session.state = 'ONBOARDING_PLOTS';
    await sessionService.setSession(from, session);
    return whatsappService.sendMessage(from, `We need to set up your plots for ${farm.farm_name}.\n\nPlease reply with a list of your plots and their current crops (e.g. "A1 has Sugarcane, A2 has Cotton").`);
  }

  // Else directly to Step 3
  await getActivities().promptActivities(from, session);
}

module.exports = { handleEmployeeCode, handleFarmCode };
