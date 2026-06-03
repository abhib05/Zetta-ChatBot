/**
 * Activity type registry for tool enum and LLM context injection.
 *
 * Required fields per activity type are NO LONGER defined here.
 * They live exclusively in: src/config/activitySchema.js
 * EXPECTED_DETAILS has been removed — do not re-add it here.
 */
const ACTIVITY_TYPES = [
  { id: 1, name: 'land_preparation',      label: 'Land Preparation' },
  { id: 2, name: 'sowing_transplanting',  label: 'Sowing / Transplanting' },
  { id: 3, name: 'irrigation',            label: 'Irrigation' },
  { id: 4, name: 'weeding',               label: 'Weeding' },
  { id: 5, name: 'agri_inputs',           label: 'Agri Inputs (Fertilizer/Pesticide)' },
  { id: 6, name: 'other_machinery_usage', label: 'Other Machinery Usage' },
  { id: 7, name: 'harvest',               label: 'Harvest' }
];

module.exports = { ACTIVITY_TYPES };
