const ACTIVITY_TYPES = [
  { id: 1, name: 'land_preparation', label: 'Land Preparation' },
  { id: 2, name: 'sowing_transplanting', label: 'Sowing / Transplanting' },
  { id: 3, name: 'irrigation', label: 'Irrigation' },
  { id: 4, name: 'weeding', label: 'Weeding' },
  { id: 5, name: 'agri_inputs', label: 'Agri Inputs (Fertilizer/Pesticide)' },
  { id: 6, name: 'other_machinery_usage', label: 'Other Machinery Usage' },
  { id: 7, name: 'harvest', label: 'Harvest' }
];

const EXPECTED_DETAILS = {
  land_preparation:      ['activity_name', 'machine_name'],
  sowing_transplanting:  ['seed_rate_per_acre', 'plants_sown', 'sowing_method', 'machine_time_minutes'],
  irrigation:            ['irrigation_method', 'power_source', 'fuel_used_litres'],
  weeding:               ['weeding_method', 'input_name', 'input_qty'],
  agri_inputs:           ['input_method', 'input_type', 'input_name', 'input_qty'],
  other_machinery_usage: ['machine_name', 'fuel_used_litres'],
  harvest:               ['harvest_cycle_no', 'harvesting_method', 'quantity', 'unit', 'machine_time_minutes'],
};

module.exports = { ACTIVITY_TYPES, EXPECTED_DETAILS };
