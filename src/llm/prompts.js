/**
 * Prompt Integration Points Registry
 * 
 * IMPORTANT: Do NOT hardcode system prompt contents.
 * These prompts will be provided separately.
 * 
 * This file defines the placeholders/hooks for the prompts
 * along with the required inputs and outputs for each layer.
 */

/**
 * Prompt Location 1: Orchestrator Layer
 * 
 * Responsibilities:
 *  - Conversation understanding
 *  - Tool selection
 *  - DTS state management
 *  - Missing field identification
 * 
 * Inputs:
 *  - userMessage: string (current raw WhatsApp message)
 *  - conversationPhase: 'COLLECTING' | 'REVIEW' | 'CONFIRMED'
 *  - draft_dts_state: array of activity objects
 *  - draft_meta: { deviation_notes, next_day_plans, agronomy_report }
 *  - farmMetadata: { farmName, farmCode, plots: [], crops: [], machines: [], submittedToday: [] }
 *  - employeeInfo: { name, code }
 *  - toolResults: array of objects representing outputs from tools executed in the current turn
 * 
 * Outputs (LLM decision):
 *  - tool_calls: structured tool invocations (handled via OpenAI tools API)
 *  - next_action: string (describing what the LLM decided to do)
 *  - responseMessage: string (WhatsApp message to send to the farmer if no further tool actions are needed)
 */
const ORCHESTRATOR_SYSTEM_PROMPT = ``;

/**
 * Prompt Location 2: Extraction Layer
 * 
 * Responsibilities:
 *  - Convert natural language into structured DTS data (activity records, metadata)
 * 
 * Inputs:
 *  - userMessage: string (natural language report)
 *  - activityTypes: array of { id, name, label }
 *  - farmMetadata: { plots: [], crops: [], machines: [] }
 * 
 * Outputs:
 *  - JSON object containing:
 *    {
 *      "activities": [
 *        {
 *          "activity_type_name": string (matching valid type names),
 *          "plot_name": string | null,
 *          "crop_name": string | null,
 *          "labour_count": number | null,
 *          "duration_minutes": number | null,
 *          "acres": number | null,
 *          "expense_amount": number | null,
 *          "remarks": string | null,
 *          "details": { ... } // expected details properties per activity type
 *        }
 *      ],
 *      "deviation_notes": string | null,
 *      "next_day_plans": string | null,
 *      "agronomy_report": string | null
 *    }
 */
const EXTRACTION_SYSTEM_PROMPT = ``;

/**
 * Prompt Location 3: Validation Layer
 * 
 * Responsibilities:
 *  - Validate DTS records for business rules and sanity constraints
 *  - Detect inconsistencies and suggest corrections
 * 
 * Inputs:
 *  - draft_dts_state: array of activity objects
 *  - farmMetadata: { plots: [], crops: [], machines: [], submittedToday: [] }
 * 
 * Outputs:
 *  - JSON object containing:
 *    {
 *      "valid": boolean,
 *      "errors": string[],
 *      "missing_fields": [
 *        { "activityId": string, "field": string }
 *      ],
 *      "corrections": [
 *        { "activityId": string, "field": string, "suggested": any, "reason": string }
 *      ]
 *    }
 */
const VALIDATION_SYSTEM_PROMPT = ``;

/**
 * Prompt Location 4: Follow-Up Layer
 * 
 * Responsibilities:
 *  - Generate natural language clarification questions for missing/incomplete fields
 * 
 * Inputs:
 *  - missing_fields: array of { activityId: string, activityType: string, field: string }
 *  - draft_dts_state: array of activity objects (for context)
 *  - farmMetadata: { plots: [], crops: [], machines: [] }
 * 
 * Outputs:
 *  - string: A clear, polite natural language question focusing only on the missing/incomplete fields.
 */
const FOLLOWUP_SYSTEM_PROMPT = ``;

/**
 * Prompt Location 5: Review Layer
 * 
 * Responsibilities:
 *  - Generate final review summary for WhatsApp display
 * 
 * Inputs:
 *  - draft_dts_state: array of activity objects
 *  - draft_meta: { deviation_notes, next_day_plans, agronomy_report }
 *  - farmInfo: { farmName, farmCode, employeeName, employeeCode, date }
 * 
 * Outputs:
 *  - string: Formatted, user-friendly WhatsApp summary report.
 */
const REVIEW_SYSTEM_PROMPT = ``;

module.exports = {
  ORCHESTRATOR_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  VALIDATION_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT
};
