/**
 * Webhook Routes — Meta WhatsApp Business API
 *
 * Meta uses TWO webhook interactions:
 *
 *  1. GET  /webhook/whatsapp  — Verification handshake (done once during setup)
 *     Meta sends: ?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=NONCE
 *     We must echo back hub.challenge if the verify_token matches.
 *
 *  2. POST /webhook/whatsapp  — Incoming message events (every farmer message)
 *     We must respond with HTTP 200 within 20 seconds or Meta retries.
 *     Processing happens asynchronously after the 200 ACK.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const config = require('../config');
const { handleIncomingMessage } = require('../handlers/conversation');
const { sendMessage, markAsRead } = require('../services/whatsapp');
const { markMessageProcessed, acquireLock, releaseLock, getSession, setSession, createSession } = require('../services/session');

// ─────────────────────────────────────────────
// GET /webhook/whatsapp — Meta verification handshake
// ─────────────────────────────────────────────
router.get('/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('✅ Meta webhook verified successfully');
    return res.status(200).send(challenge); // Echo the challenge back
  }

  console.warn('⚠️  Webhook verification failed — token mismatch');
  return res.status(403).json({ error: 'Verification failed' });
});

// ─────────────────────────────────────────────
// POST /webhook/whatsapp — Incoming messages from farmers
// ─────────────────────────────────────────────
router.post('/whatsapp', async (req, res) => {
  // ── 0. Verify Signature ───────────────────────────────────────
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    console.warn('⚠️ Webhook missing signature');
    return res.status(401).send('Missing signature');
  }

  const expectedHash = crypto
    .createHmac('sha256', config.whatsapp.appSecret)
    .update(req.rawBody || '')
    .digest('hex');

  if (`sha256=${expectedHash}` !== signature) {
    console.warn('⚠️ Webhook signature mismatch');
    return res.status(403).send('Invalid signature');
  }

  // ── ACK Meta immediately ───────────────────────────────────────
  res.status(200).send('EVENT_RECEIVED');

  // ── Parse the Meta webhook payload ────────────────────────────
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') return;

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    if (!value || changes?.field !== 'messages') return;

    const messages = value.messages;
    const statuses = value.statuses;

    if (statuses && statuses.length > 0) {
      statuses.forEach((s) =>
        console.log(`📋 Status [${s.status}] for msg ${s.id} to ${s.recipient_id}`)
      );
      return;
    }

    if (!messages || messages.length === 0) return;

    const message  = messages[0];
    const from     = message.from;
    const msgId    = message.id;
    const msgType  = message.type;

    if (!from) return;

    // ── Check idempotency at Redis level ──
    const isNewMessage = await markMessageProcessed(msgId);
    if (!isNewMessage) {
      console.log(`⏭️  Skipping duplicate message (Redis): ${msgId}`);
      return;
    }

    // Mark as read
    markAsRead(msgId).catch(() => {});

    if (msgType !== 'text') {
      console.log(`📎 Non-text message (${msgType}) from ${from} — ignoring`);
      sendMessage(from, 'I can only read text messages. Please type your daily report.')
        .catch(console.error);
      return;
    }

    const text = message.text?.body?.trim();
    if (!text) {
      console.warn(`⚠️  Empty text from ${from}`);
      return;
    }

    console.log(`📱 [IN] ${from}: ${text}`);

    // ── Retrieve or create session ──
    let session = await getSession(from);
    if (!session) {
      session = await createSession(from);
    }

    // Check message idempotency at session level
    session.processed_message_ids = session.processed_message_ids || [];
    if (session.processed_message_ids.includes(msgId)) {
      console.log(`⏭️  Skipping duplicate message (Session): ${msgId}`);
      return;
    }

    // Append to queue
    session.message_queue = session.message_queue || [];
    session.message_queue.push({ msgId, text, timestamp: Date.now() });
    await setSession(from, session);

    // ── Lock Check & Heartbeat Recovery ──
    let locked = await acquireLock(from);
    if (!locked) {
      if (session.processing_started_at) {
        const elapsed = Date.now() - new Date(session.processing_started_at).getTime();
        if (elapsed > 30000) { // 30 seconds lock timeout
          console.warn(`⚠️ Lock timeout detected for ${from} (elapsed: ${elapsed}ms). Recovering lock.`);
          await releaseLock(from);
          locked = await acquireLock(from);
        }
      }
    }

    if (!locked) {
      console.log(`🔒 Concurrent message queued for ${from}: lock active.`);
      return;
    }

    // ── FIFO Processing Loop ──
    try {
      while (true) {
        session = await getSession(from);
        if (!session || !session.message_queue || session.message_queue.length === 0) {
          break;
        }

        const nextMsg = session.message_queue.shift();
        session.processed_message_ids = session.processed_message_ids || [];
        session.processed_message_ids.push(nextMsg.msgId);
        if (session.processed_message_ids.length > 100) {
          session.processed_message_ids.shift();
        }
        
        session.processing_started_at = new Date().toISOString();
        await setSession(from, session);

        try {
          await handleIncomingMessage(from, nextMsg.text);
        } catch (err) {
          console.error(`Unhandled error processing message from ${from}:`, err);
        }
      }
    } finally {
      // Clear processing start time and release lock
      session = await getSession(from);
      if (session) {
        session.processing_started_at = null;
        await setSession(from, session);
      }
      await releaseLock(from);
    }

  } catch (err) {
    console.error('Webhook parse error:', err);
  }
});

module.exports = router;
