/**
 * OpenAI Tool Definitions
 * 
 * Defines schemas for the tools that the LLM orchestrator can invoke.
 * The tools operate purely on the session draft state, validation,
 * and final submission. No tools access the database directly.
 */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_draft_activity',
      description: 'Add a new activity record to the daily task sheet (DTS) draft.',
      parameters: {
        type: 'object',
        properties: {
          activity_type_name: {
            type: 'string',
            description: 'The type name of the activity, e.g., land_preparation, sowing_transplanting, irrigation, weeding, agri_inputs, other_machinery_usage, harvest.',
            enum: ['land_preparation', 'sowing_transplanting', 'irrigation', 'weeding', 'agri_inputs', 'other_machinery_usage', 'harvest']
          },
          plot_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of plot codes where this activity took place (e.g., ["A1", "A2"]).'
          },
          crop_name: {
            type: 'string',
            description: 'Name of the crop associated with the activity (e.g., "Sugarcane", "Wheat").'
          },
          acres: {
            type: 'number',
            description: 'Acres of land covered.'
          },
          labour_count: {
            type: 'integer',
            description: 'Number of laborers engaged.'
          },
          duration_minutes: {
            type: 'integer',
            description: 'Duration of the activity in minutes.'
          },
          expense_amount: {
            type: 'number',
            description: 'Expenses incurred for this activity.'
          },
          remarks: {
            type: 'string',
            description: 'Any notes or remarks about the activity.'
          },
          details: {
            type: 'object',
            description: 'Specific details depending on the activity type.',
            properties: {
              // land_preparation
              activity_name: { type: 'string', description: 'Name of the preparation activity (e.g. Ploughing, Harrowing).' },
              machine_name: { type: 'string', description: 'Machine name used (e.g. Tractor).' },
              time_minutes: { type: 'integer' },
              
              // sowing_transplanting
              seed_rate_per_acre: { type: 'number' },
              plants_sown: { type: 'integer' },
              sowing_method: { type: 'string' },
              machine_time_minutes: { type: 'integer' },
              
              // irrigation
              irrigation_method: { type: 'string' },
              power_source: { type: 'string', enum: ['solar', 'electricity', 'generator'] },
              fuel_used_litres: { type: 'number' },
              
              // weeding
              weeding_method: { type: 'string' },
              input_name: { type: 'string' },
              input_qty: { type: 'number' },
              
              // agri_inputs
              input_method: { type: 'string' },
              input_type: { type: 'string', description: 'e.g. fertilizer, pesticide' },
              // input_name, input_qty are shared with weeding
              
              // harvest
              harvest_cycle_no: { type: 'integer' },
              harvesting_method: { type: 'string' },
              quantity: { type: 'number', description: 'Harvested quantity' },
              unit: { type: 'string', description: 'Unit of quantity, usually tonnes' }
            }
          }
        },
        required: ['activity_type_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_draft_dts',
      description: 'Update fields in an existing draft activity by its local ID.',
      parameters: {
        type: 'object',
        properties: {
          activityId: {
            type: 'string',
            description: 'The local ID of the activity to update (e.g., "act_1").'
          },
          fields: {
            type: 'object',
            description: 'The fields to update in the activity.',
            properties: {
              plot_names: {
                type: 'array',
                items: { type: 'string' }
              },
              crop_name: { type: 'string' },
              acres: { type: 'number' },
              labour_count: { type: 'integer' },
              duration_minutes: { type: 'integer' },
              expense_amount: { type: 'number' },
              remarks: { type: 'string' },
              details: { type: 'object' }
            }
          }
        },
        required: ['activityId', 'fields']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_draft_activity',
      description: 'Remove an activity from the DTS draft list.',
      parameters: {
        type: 'object',
        properties: {
          activityId: {
            type: 'string',
            description: 'The local ID of the activity to remove.'
          }
        },
        required: ['activityId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clear_draft_fields',
      description: 'Clear/reset specific fields to null from an activity (used when a user corrects/disputes fields).',
      parameters: {
        type: 'object',
        properties: {
          activityId: {
            type: 'string',
            description: 'The local ID of the activity.'
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of field names to reset to null (e.g., ["labour_count", "duration_minutes"]). Can include details sub-fields prefixing with details., e.g., "details.machine_name".'
          }
        },
        required: ['activityId', 'fields']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'confirm_plot_grouping',
      description: 'Confirm whether the same work was done across multiple plots for a grouped activity.',
      parameters: {
        type: 'object',
        properties: {
          activityId: {
            type: 'string',
            description: 'The local ID of the activity.'
          },
          sameWork: {
            type: 'boolean',
            description: 'True if the same work was done across all plots, false if different work was done.'
          }
        },
        required: ['activityId', 'sameWork']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'validate_draft',
      description: 'Validate the current draft task sheet. Checks for missing fields, sowing conflicts, and duplicate submissions.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_review_summary',
      description: 'Generate a formatted final review summary text of the draft sheet to display to the user.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'submit_dts',
      description: 'Confirm and submit the final task sheet to the database. MUST only be called after explicit user approval of the review.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

module.exports = { TOOLS };
