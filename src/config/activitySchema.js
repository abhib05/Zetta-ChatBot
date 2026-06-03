/**
 * Activity Schema Configuration — Single Source of Truth
 *
 * This file is the ONLY place where required fields per DTS activity type are defined.
 * - validate_draft()   reads from this schema to determine missing fields.
 * - callOrchestrator() injects a schema summary into the LLM system prompt.
 * - callFollowUp()     uses fieldLabels to generate human-friendly questions.
 * - submit_dts()       blocks submission if schema validation fails.
 *
 * To add/remove a required field for an activity type, edit this file ONLY.
 * No other file should contain hardcoded required-field lists.
 *
 * Schema per activity:
 *   baseFields    — required fields on the activity root object (mirrors dts_activity_entries columns + crop_name/plot_names)
 *   detailFields  — required fields inside act.details (mirrors the activity-specific detail table columns)
 *   optionalFields— fields that are stored if provided but NEVER block submission
 *   fieldLabels   — human-readable label for each field, used in follow-up questions
 */

const ACTIVITY_SCHEMA = {

  // ── Land Preparation ─────────────────────────────────────────────────────
  // DB table: dts_land_preparation_details
  // No crop required. No labour_count / duration_minutes required (optional).
  land_preparation: {
    label: 'Land Preparation',
    baseFields: ['plot_names', 'acres'],
    detailFields: ['activity_name', 'machine_name', 'time_minutes', 'expense_amount'],
    optionalFields: ['labour_count', 'duration_minutes'],
    fieldLabels: {
      plot_names:    'Plot(s)',
      acres:         'Acres covered',
      activity_name: 'Activity name (e.g. Ploughing, Harrowing, Rotavating)',
      machine_name:  'Machine used (e.g. Tractor, Rotavator)',
      time_minutes:  'Time taken (minutes)',
      expense_amount:'Expense amount (₹)',
      labour_count:  'Number of labourers (optional)',
    }
  },

  // ── Sowing / Transplanting ────────────────────────────────────────────────
  // DB table: dts_sowing_transplanting_details
  sowing_transplanting: {
    label: 'Sowing / Transplanting',
    baseFields: ['plot_names', 'crop_name', 'acres'],
    detailFields: ['sowing_method', 'labour_count', 'machine_time_minutes', 'expense_amount'],
    optionalFields: ['seed_rate_per_acre', 'plants_sown'],
    fieldLabels: {
      plot_names:           'Plot(s)',
      crop_name:            'Crop name',
      acres:                'Acres covered',
      sowing_method:        'Sowing method (e.g. Manual, Dibbling, Transplanting)',
      labour_count:         'Number of labourers',
      machine_time_minutes: 'Machine time (minutes)',
      expense_amount:       'Expense amount (₹)',
      seed_rate_per_acre:   'Seed rate per acre (optional)',
      plants_sown:          'Plants sown — count (optional)',
    }
  },

  // ── Irrigation ────────────────────────────────────────────────────────────
  // DB table: dts_irrigation_details
  // fuel_used_litres is optional (only relevant for generator power source)
  irrigation: {
    label: 'Irrigation',
    baseFields: ['plot_names', 'crop_name', 'acres'],
    detailFields: ['irrigation_method', 'labour_count', 'power_source', 'time_minutes', 'expense_amount'],
    optionalFields: ['fuel_used_litres'],
    fieldLabels: {
      plot_names:        'Plot(s)',
      crop_name:         'Crop name',
      acres:             'Acres covered',
      irrigation_method: 'Irrigation method (e.g. Drip, Flood, Sprinkler)',
      labour_count:      'Number of labourers',
      power_source:      'Power source (solar / electricity / generator)',
      time_minutes:      'Duration (minutes)',
      expense_amount:    'Expense amount (₹)',
      fuel_used_litres:  'Fuel used in litres (optional, required if generator)',
    }
  },

  // ── Weeding ───────────────────────────────────────────────────────────────
  // DB table: dts_weeding_details
  weeding: {
    label: 'Weeding',
    baseFields: ['plot_names', 'crop_name', 'acres'],
    detailFields: ['weeding_method', 'labour_count', 'input_name', 'input_qty', 'time_minutes', 'expense_amount'],
    optionalFields: [],
    fieldLabels: {
      plot_names:    'Plot(s)',
      crop_name:     'Crop name',
      acres:         'Acres covered',
      weeding_method:'Weeding method (e.g. Manual, Chemical, Mechanical)',
      labour_count:  'Number of labourers',
      input_name:    'Chemical / input name used',
      input_qty:     'Input quantity applied',
      time_minutes:  'Duration (minutes)',
      expense_amount:'Expense amount (₹)',
    }
  },

  // ── Agri Inputs ───────────────────────────────────────────────────────────
  // DB table: dts_agri_input_details
  agri_inputs: {
    label: 'Agri Inputs (Fertilizer / Pesticide)',
    baseFields: ['plot_names', 'crop_name', 'acres'],
    detailFields: ['input_method', 'input_type', 'input_name', 'input_qty', 'labour_count', 'time_minutes', 'expense_amount'],
    optionalFields: [],
    fieldLabels: {
      plot_names:    'Plot(s)',
      crop_name:     'Crop name',
      acres:         'Acres covered',
      input_method:  'Application method (e.g. Spray, Broadcast, Drip)',
      input_type:    'Input type (e.g. fertilizer, pesticide, herbicide)',
      input_name:    'Input / chemical name',
      input_qty:     'Quantity applied',
      labour_count:  'Number of labourers',
      time_minutes:  'Duration (minutes)',
      expense_amount:'Expense amount (₹)',
    }
  },

  // ── Other Machinery Usage ─────────────────────────────────────────────────
  // DB table: dts_other_machinery_details
  // No crop required. No labour_count / duration_minutes required (optional).
  other_machinery_usage: {
    label: 'Other Machinery Usage',
    baseFields: ['plot_names', 'acres'],
    detailFields: ['machine_name', 'time_minutes', 'fuel_used_litres'],
    optionalFields: ['crop_name', 'labour_count', 'duration_minutes'],
    fieldLabels: {
      plot_names:       'Plot(s)',
      acres:            'Acres covered',
      machine_name:     'Machine used',
      time_minutes:     'Machine operating time (minutes)',
      fuel_used_litres: 'Fuel used (litres)',
      crop_name:        'Crop name (if applicable, optional)',
    }
  },

  // ── Harvest ───────────────────────────────────────────────────────────────
  // DB table: dts_harvest_details
  harvest: {
    label: 'Harvest',
    baseFields: ['plot_names', 'crop_name', 'acres'],
    detailFields: ['harvest_cycle_no', 'harvesting_method', 'quantity', 'unit', 'labour_count', 'machine_time_minutes', 'expense_amount'],
    optionalFields: [],
    fieldLabels: {
      plot_names:           'Plot(s)',
      crop_name:            'Crop name',
      acres:                'Acres covered',
      harvest_cycle_no:     'Harvest cycle number',
      harvesting_method:    'Harvesting method (e.g. Manual, Machine)',
      quantity:             'Quantity harvested',
      unit:                 'Unit of quantity (e.g. tonnes, kg, bags)',
      labour_count:         'Number of labourers',
      machine_time_minutes: 'Machine time (minutes)',
      expense_amount:       'Expense amount (₹)',
    }
  }

};

// ─────────────────────────────────────────────────────────────────────────────
// META-LEVEL FIELDS (submission-level, not per-activity)
// These are always optional and never block submission.
// ─────────────────────────────────────────────────────────────────────────────

const META_FIELDS = {
  optional: ['deviation_notes', 'next_day_plans', 'agronomy_report'],
  monitoring_optional: [
    'morning_observation_time',
    'evening_observation_time',
    'temperature',
    'humidity',
    'rainfall'
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA CONTEXT BUILDER
// Generates a concise text summary of required fields for each activity type.
// Injected dynamically into the orchestrator system prompt so the LLM always
// knows current requirements without any hardcoding in the prompt string.
// ─────────────────────────────────────────────────────────────────────────────

function buildSchemaContext() {
  const lines = Object.entries(ACTIVITY_SCHEMA).map(([type, schema]) => {
    const required = [...schema.baseFields, ...schema.detailFields].join(', ');
    const optional = schema.optionalFields.length
      ? ` | optional: ${schema.optionalFields.join(', ')}`
      : '';
    return `  - ${type} (aka ${schema.label}): required=[${required}]${optional}`;
  });
  return lines.join('\n');
}

/**
 * Get a human-readable label for a field on a given activity type.
 * field may be a root field (e.g. 'acres') or a details sub-field (e.g. 'details.machine_name').
 */
function getFieldLabel(activityTypeName, field) {
  const schema = ACTIVITY_SCHEMA[activityTypeName];
  if (!schema) return field.replace(/_/g, ' ');
  const rawKey = field.startsWith('details.') ? field.replace('details.', '') : field;
  return schema.fieldLabels[rawKey] || rawKey.replace(/_/g, ' ');
}

module.exports = { ACTIVITY_SCHEMA, META_FIELDS, buildSchemaContext, getFieldLabel };
