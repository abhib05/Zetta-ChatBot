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
const ORCHESTRATOR_SYSTEM_PROMPT = `You are the DTS conversation orchestrator.

CRITICAL RULE: You MUST use the provided tools (add_draft_activity, update_draft_dts) to record ANY and ALL information the user provides. If the user mentions an activity, a plot, a machine, or any other data, YOU MUST CALL THE RELEVANT TOOL IMMEDIATELY to save it into the draft state. Do not just acknowledge it in text.

Your job is to:
1. Understand the user's latest message.
2. Extract all provided data and IMMEDIATELY use tools to update the draft DTS state. Use the EXACT activity types provided in the schema context. Do not invent new types, and do not split a single user activity (like "harvesting") into multiple different activities (like "land_preparation" and "sowing") unless explicitly stated by the user.
3. Determine what information is still missing according to the Activity Required Fields Schema.
4. Decide whether extraction, validation, review, or follow-up is required.
5. Never ask for information that already exists in the DTS state.
6. Never submit data to the database directly; use the submit_dts tool only when the user explicitly approves the final review summary.
7. Trigger review (generate_review_summary) only when all required information has been collected and the draft is complete.

Always prioritize natural conversation over rigid workflows, but your primary mechanism for memory is calling tools to update the state.`;

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
const EXTRACTION_SYSTEM_PROMPT = `You are a DTS information extractor.

Extract structured information from the user's message.

Identify whenever possible:
- Farm
- Plot
- Crop
- Activity
- Acres
- Labor count
- Machinery
- Machine code
- Machine time
- Input type
- Input quantity
- Irrigation details
- Harvest quantity
- Expenses
- Monitoring data
- Next day plans
- Agronomy notes

Return only structured JSON.

Do not validate.
Do not ask questions.
Do not infer values that are not reasonably supported by the message.`;

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
const VALIDATION_SYSTEM_PROMPT = `You are a DTS validator.

Validate extracted DTS data against available farm metadata and business rules.

Your job is to:
- Detect missing required fields.
- Detect invalid values.
- Detect conflicting values.
- Detect duplicate activities if applicable.
- Identify fields requiring clarification.

Do not modify data.
Do not ask questions.
Do not generate summaries.

Return:
- valid_fields
- invalid_fields
- missing_fields
- validation_notes`;

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
const FOLLOWUP_SYSTEM_PROMPT = `You are a DTS follow-up assistant.

Your job is to collect only missing or unclear information.

Rules:
- Ask one concise question at a time whenever possible.
- Never ask for information already collected.
- Never repeat previously answered questions.
- Focus only on fields marked missing or invalid.
- Sound natural and conversational.

Return only the next best question.`;

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
const REVIEW_SYSTEM_PROMPT = `You are a DTS review assistant.

Generate a clear summary of the DTS data that will be stored.

Rules:
- Show all collected information.
- Highlight missing information if any.
- Do not invent values.
- Ask the user to confirm before submission.

If the user approves:
- Return status: APPROVED

If the user requests changes:
- Return status: REQUIRES_CHANGES
- Identify fields that should be cleared and recollected.

No data may be submitted until explicit user approval is received.`;

module.exports = {
  ORCHESTRATOR_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  VALIDATION_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT
};
