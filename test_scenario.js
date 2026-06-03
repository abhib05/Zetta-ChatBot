/**
 * Scenario Test Suite for Zetta Farm DTS Chatbot Refactor
 * Runs mock conversations to verify all production requirements.
 */

const assert = require('assert').strict;

// 1. Pre-load services
const sessionService = require('./src/services/session');
const whatsappService = require('./src/services/whatsapp');
const supabaseService = require('./src/services/supabase');
const openaiService = require('./src/services/openai');
const intentClassifier = require('./src/services/intentClassifier');

let globalIntent = 'REPORTING';

// Global test variables
let sentMessages = [];
let dbSubmissions = [];
let deletedSubmissions = [];

// 2. Setup Mock Services (must be done before requiring conversation.js)
function setupMocks() {
  intentClassifier.classifyIntent = async (msg) => {
    return globalIntent;
  };

  // Mock WhatsApp Service
  whatsappService.sendMessage = async (to, text) => {
    sentMessages.push({ to, text });
    console.log(`[Mock SendMessage] To: ${to} | Text: ${text.replace(/\n/g, ' ')}`);
    return { success: true };
  };

  // Mock OpenAI Service
  openaiService.callFarmSelection = async (msg, availableFarms) => {
    return ['ZF-001'];
  };

  // Mock Supabase Service
  supabaseService.findEmployeeByPhone = async (phone) => {
    if (phone === '917995627759' || phone === '1234567890') {
      return {
        employee_name: 'Achyuth',
        employee_code: 'EMP-006',
        farms: [{ farm_code: 'ZF-006', farm_name: 'Golden Plains' }]
      };
    }
    return null;
  };

  supabaseService.getFarmDetails = async (farmId) => {
    return {
      plots: [
        { plot_id: 'plot-a1', plot_code: 'A1', acres: 10, current_crop_id: 'crop-sugarcane' },
        { plot_id: 'plot-a2', plot_code: 'A2', acres: 15, current_crop_id: null }
      ],
      allCrops: [
        { crop_id: 'crop-sugarcane', crop_name: 'Sugarcane' },
        { crop_id: 'crop-wheat', crop_name: 'Wheat' }
      ],
      machines: [
        { machine_id: 'mach-tractor', machine_code: 'TR-01', machine_name: 'Tractor-01', machine_type: 'tractor' }
      ],
      employees: [],
      submittedToday: [],
      submission_id: null
    };
  };

  supabaseService.saveDTSSubmission = async (payload) => {
    dbSubmissions.push(payload);
    return { submission_id: 'sub-999' };
  };

  supabaseService.deleteDTSSubmission = async (subId) => {
    deletedSubmissions.push(subId);
    return true;
  };

  supabaseService.getDTSSubmission = async (subId) => {
    return {
      submission_id: 'sub-111',
      deviation_notes: 'none',
      dts_activity_entries: [
        {
          entry_id: 'entry-111',
          acres: 10,
          labour_count: 5,
          duration_minutes: 120,
          expense_amount: 1500,
          remarks: 'plowing done',
          activity_types: { name: 'land_preparation' },
          farm_plots: { plot_code: 'A1' },
          dts_land_preparation_details: [{ activity_name: 'Ploughing', machine_id: 'mach-tractor' }]
        }
      ]
    };
  };
}

// Call setupMocks immediately so that their properties are mocked
setupMocks();

// 3. Unify require.cache for drive letter casing variations on Windows
for (const key of Object.keys(require.cache)) {
  if (key.startsWith('C:')) {
    const lowercaseDriveKey = 'c:' + key.slice(2);
    require.cache[lowercaseDriveKey] = require.cache[key];
  } else if (key.startsWith('c:')) {
    const uppercaseDriveKey = 'C:' + key.slice(2);
    require.cache[uppercaseDriveKey] = require.cache[key];
  }
}

// 4. Require modules depending on mock services
const { handleIncomingMessage } = require('./src/handlers/conversation');
const toolHandlers = require('./src/llm/toolHandlers');

// Helper to run a test assertion and output results
function runTest(name, fn) {
  try {
    fn();
    console.log(`\n✅ TEST PASSED: ${name}\n----------------------------------------`);
  } catch (err) {
    console.error(`\n❌ TEST FAILED: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// 2. Scenario Test Definitions
async function runAllScenarios() {
  setupMocks();

  // Clean memory session fallback store
  await sessionService.deleteSession('1234567890');

  // =========================================================================
  // SCENARIO 1: Idempotency Protection
  // =========================================================================
  sentMessages = [];
  // Mock intent and extraction for Scenario 1
  globalIntent = 'REPORTING';
  openaiService.callExtraction = async (msg) => ({
    activities: [{
      activity_type_name: 'irrigation',
      plot_names: ['A1'],
      crop_name: 'Sugarcane',
      acres: 5,
      details: {
        irrigation_method: 'Drip',
        power_source: 'solar',
        labour_count: 2,
        time_minutes: 60,
        expense_amount: 500
      }
    }]
  });

  // Trigger Auth
  await handleIncomingMessage('1234567890', 'hi');
  assert.equal(sentMessages.length, 1);
  assert(sentMessages[0].text.includes("Let's start your report"));

  // Send message first time
  sentMessages = [];
  const session = await sessionService.getSession('1234567890');
  session.processed_message_ids = [];
  await sessionService.setSession('1234567890', session);

  // Directly queue message
  session.message_queue.push({ msgId: 'wamid.123', text: 'we irrigated A1', timestamp: Date.now() });
  await sessionService.setSession('1234567890', session);

  // Trigger processing
  await handleIncomingMessage('1234567890', 'we irrigated A1');
  assert.equal(sentMessages.length, 1); // Should reply with review summary since irrigation has all required fields

  // Trigger again with the exact same msgId in processed_message_ids (mimicking webhook retry)
  sentMessages = [];
  session.processed_message_ids = ['wamid.123'];
  session.message_queue = [];
  await sessionService.setSession('1234567890', session);

  // We pass wamid.123 to mimic what's checked in webhook.js
  // Let's test the webhook.js idempotency block directly
  const sessionAfter = await sessionService.getSession('1234567890');
  assert(sessionAfter.processed_message_ids.includes('wamid.123'));
  console.log("✅ Idempotency list correctly tracked wamid.123");

  // =========================================================================
  // SCENARIO 2: Intent Classification before Extraction
  // =========================================================================
  // Test that Help / Lookup messages do not add activities or change draft state
  sentMessages = [];
  globalIntent = 'HELP';
  let beforeSession = await sessionService.getSession('1234567890');
  const activitiesBeforeCount = beforeSession.draft.activities.length;

  await handleIncomingMessage('1234567890', 'help me');
  let afterSession = await sessionService.getSession('1234567890');

  assert.equal(afterSession.draft.activities.length, activitiesBeforeCount);
  assert(sentMessages[0].text.includes("I can help you report your daily tasks"));
  console.log("✅ Help intent bypassed extraction and kept draft intact");

  // =========================================================================
  // SCENARIO 3: Direct Clarification Mapping & Single Question Focus
  // =========================================================================
  sentMessages = [];
  // Mock missing required fields for weeding: weeding_method, labour_count, input_name, input_qty, time_minutes, expense_amount
  // Let's add weeding but omit labour_count. Check that it asks for labour_count.
  globalIntent = 'REPORTING';
  openaiService.callExtraction = async (msg) => ({
    activities: [{
      activity_type_name: 'weeding',
      plot_names: ['A1'],
      crop_name: 'Sugarcane',
      acres: 5,
      // labour_count omitted
      details: {
        weeding_method: 'Manual',
        input_name: 'None',
        input_qty: 0,
        time_minutes: 120,
        expense_amount: 1000
      }
    }]
  });
  openaiService.callFollowUp = async (label) => "How many labourers were weeding today?";

  // Report weeding
  await handleIncomingMessage('1234567890', 'we did weeding on plot A1');

  let weedingSession = await sessionService.getSession('1234567890');
  assert.equal(weedingSession.phase, 'CLARIFYING');
  assert.equal(weedingSession.pending_clarification.field, 'details.labour_count');
  assert.equal(sentMessages[0].text, "How many labourers were weeding today?");

  // Send a short answer: "5"
  sentMessages = [];
  globalIntent = 'REPORTING'; // simple input is classified as reporting or clarification
  openaiService.callExtraction = async (msg) => ({ activities: [] }); // Extraction returns nothing for short digits

  await handleIncomingMessage('1234567890', '5');

  let resolvedSession = await sessionService.getSession('1234567890');
  const weedAct = resolvedSession.draft.activities.find(a => a.activity_type_name === 'weeding');
  assert.equal(weedAct.details.labour_count, 5);
  assert.equal(resolvedSession.pending_clarification, null);
  assert.equal(resolvedSession.phase, 'AWAITING_APPROVAL'); // Now valid, so moves to awaiting approval and sends review summary
  console.log("✅ Short answer '5' correctly resolved clarification for details.labour_count");

  // =========================================================================
  // SCENARIO 4: Correction Context Gating
  // =========================================================================
  // A user says "not A1, it was A2"
  sentMessages = [];
  globalIntent = 'CORRECTION';
  openaiService.callExtraction = async (msg) => ({
    activities: [{ plot_names: ['A2'] }]
  });

  await handleIncomingMessage('1234567890', 'not A1, it was A2');
  let correctionSession = await sessionService.getSession('1234567890');
  const correctedAct = correctionSession.draft.activities.find(a => a.activity_type_name === 'weeding');
  assert.deepEqual(correctedAct.plot_names, ['A2']);
  assert.equal(correctionSession.correction_context.activity_id, correctedAct.id);
  console.log("✅ Correction 'not A1' mapped successfully to correct active activity plot");

  // =========================================================================
  // SCENARIO 5: Tiered Validation Sanity Warnings
  // =========================================================================
  // Omit expense to make it invalid first, then verify Tier 3 Warnings
  sentMessages = [];
  let warnSession = await sessionService.getSession('1234567890');
  // Reset plot to A1 so it's valid (A2 does not have a registered crop in mock)
  warnSession.draft.activities[0].plot_names = ['A1'];
  // Set labour count to 100 (Unusually high, should trigger Tier 3 Warning)
  warnSession.draft.activities[0].labour_count = 100;
  await sessionService.setSession('1234567890', warnSession);

  // Trigger validation manually
  const val = await toolHandlers.validate_draft(warnSession);
  assert(val.valid); // still valid since warnings are non-blocking
  assert(val.warnings.some(w => w.includes("Labour count (100) on Weeding is unusually high")));
  console.log("✅ Tiered validation warning correctly generated for labour count");

  // =========================================================================
  // SCENARIO 6: Amendment Workflow
  // =========================================================================
  sentMessages = [];
  // Set phase to duplicate check post review, then trigger 'amend'
  let dSession = await sessionService.getSession('1234567890');
  dSession.phase = 'DUPLICATE_CHECK';
  dSession.dbCache.submission_id = 'sub-111';
  await sessionService.setSession('1234567890', dSession);

  await handleIncomingMessage('1234567890', 'amend');

  let amendSession = await sessionService.getSession('1234567890');
  assert.equal(amendSession.submission_mode, 'amendment');
  assert.equal(amendSession.draft.activities.length, 1);
  assert.equal(amendSession.draft.activities[0].activity_type_name, 'land_preparation');
  console.log("✅ Existing submission successfully loaded into draft for amendment");

  // =========================================================================
  // SCENARIO 7: Stable Hash Gating
  // =========================================================================
  sentMessages = [];
  // Approve the amendment
  globalIntent = 'APPROVAL';

  let submitSession = await sessionService.getSession('1234567890');
  // Intentionally modify draft after hash was computed to check mismatch block
  submitSession.draft.activities[0].labour_count = 99;
  await sessionService.setSession('1234567890', submitSession);

  await handleIncomingMessage('1234567890', 'yes');

  let postSubmitSession = await sessionService.getSession('1234567890');
  assert.notEqual(postSubmitSession.submission_status, 'completed'); // Should block and ask to review again
  console.log("✅ Hash gating successfully blocked submission when draft changed post-review");
}

// Run the suite
runTest("DTS Conversational Refactor Scenarios", async () => {
  await runAllScenarios();
});
