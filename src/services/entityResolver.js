const stringSimilarity = require('string-similarity');

// Strict static crop alias dictionary to resolve common variants and typos
const CROP_ALIASES = {
  'sugar cane': 'Sugarcane',
  'sugercane': 'Sugarcane',
  'cane': 'Sugarcane',
  'weat': 'Wheat',
  'paddy': 'Rice',
  'corn': 'Maize'
};

/**
 * Normalize text for strict comparison (alphanumeric, lowercase)
 */
function normalizeString(str) {
  if (!str) return '';
  return str.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/**
 * Resolve plot code against available farm plots in cache.
 * Normalizes input like "a-1", "a 1", "A_1", "a1" to match "A1".
 */
function resolvePlot(plotInput, plots) {
  if (!plotInput || !plots || plots.length === 0) return plotInput;
  
  const normalizedInput = normalizeString(plotInput);
  
  // 1. Try exact normalized match
  const match = plots.find(p => normalizeString(p.plot_code) === normalizedInput);
  if (match) return match.plot_code;

  return plotInput.toUpperCase().trim();
}

/**
 * Resolve crop name against available crops in the system.
 */
function resolveCrop(cropInput, allCrops) {
  if (!cropInput || !allCrops || allCrops.length === 0) return cropInput;

  const trimmedInput = cropInput.trim().toLowerCase();

  // 1. Check strict alias dictionary
  if (CROP_ALIASES[trimmedInput]) {
    const aliasMatch = allCrops.find(c => c.crop_name.toLowerCase() === CROP_ALIASES[trimmedInput].toLowerCase());
    if (aliasMatch) return aliasMatch.crop_name;
  }

  // 2. Try exact lowercase/substring match
  const directMatch = allCrops.find(c => c.crop_name.toLowerCase() === trimmedInput);
  if (directMatch) return directMatch.crop_name;

  const substringMatch = allCrops.find(c => c.crop_name.toLowerCase().includes(trimmedInput) || trimmedInput.includes(c.crop_name.toLowerCase()));
  if (substringMatch) return substringMatch.crop_name;

  // 3. Fall back to string similarity with high threshold (0.7) to prevent wrong resolutions
  const choices = allCrops.map(c => c.crop_name.toLowerCase());
  const matches = stringSimilarity.findBestMatch(trimmedInput, choices);
  if (matches.bestMatch.rating >= 0.7) {
    return allCrops[matches.bestMatchIndex].crop_name;
  }

  return cropInput;
}

/**
 * Resolve machine name/code against available machines.
 */
function resolveMachine(machineInput, machines) {
  if (!machineInput || !machines || machines.length === 0) return machineInput;

  const normalizedInput = normalizeString(machineInput);

  // 1. Try matching normalized input to normalized machine_code or machine_name
  let match = machines.find(m => 
    normalizeString(m.machine_code) === normalizedInput || 
    normalizeString(m.machine_name) === normalizedInput
  );
  if (match) return match.machine_name;

  // 2. Try partial substring matching
  match = machines.find(m => 
    normalizeString(m.machine_name).includes(normalizedInput) || 
    normalizedInput.includes(normalizeString(m.machine_name))
  );
  if (match) return match.machine_name;

  // 3. High threshold fuzzy matching
  const choices = machines.map(m => m.machine_name.toLowerCase());
  const matches = stringSimilarity.findBestMatch(machineInput.toLowerCase(), choices);
  if (matches.bestMatch.rating >= 0.7) {
    return machines[matches.bestMatchIndex].machine_name;
  }

  return machineInput;
}

/**
 * Perform bulk entity resolution on extracted activities.
 */
function resolveEntities(activities, dbCache) {
  if (!activities || !Array.isArray(activities)) return [];

  return activities.map(act => {
    // Resolve plot names
    if (act.plot_names && Array.isArray(act.plot_names)) {
      act.plot_names = act.plot_names.map(p => resolvePlot(p, dbCache.plots));
    }

    // Resolve crop name
    if (act.crop_name) {
      act.crop_name = resolveCrop(act.crop_name, dbCache.allCrops);
    }

    // Resolve machine name in details
    if (act.details && act.details.machine_name) {
      act.details.machine_name = resolveMachine(act.details.machine_name, dbCache.machines);
    }

    return act;
  });
}

module.exports = {
  resolvePlot,
  resolveCrop,
  resolveMachine,
  resolveEntities
};
