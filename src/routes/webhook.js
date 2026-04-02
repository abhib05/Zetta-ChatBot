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
const config = require('../config');
const { handleIncomingMessage } = require('../handlers/conversation');
const { sendMessage, markAsRead } = require('../services/whatsapp');

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
router.post('/whatsapp', (req, res) => {
  // ── ACK Meta immediately ───────────────────────────────────────
  // Meta requires HTTP 200 within 20s or it retries (causing duplicate processing).
  res.status(200).send('EVENT_RECEIVED');

  // ── Parse the Meta webhook payload ────────────────────────────
  try {
    const body = req.body;

    // Safety check — only handle whatsapp_business_account events
    if (body.object !== 'whatsapp_business_account') return;

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    if (!value || changes?.field !== 'messages') return;

    const messages = value.messages;
    const statuses = value.statuses;

    // ── Handle status updates (delivered, read) — log and ignore ──
    if (statuses && statuses.length > 0) {
      statuses.forEach((s) =>
        console.log(`📋 Status [${s.status}] for msg ${s.id} to ${s.recipient_id}`)
      );
      return;
    }

    // ── Handle actual incoming messages ───────────────────────────
    if (!messages || messages.length === 0) return;

    const message  = messages[0];
    const from     = message.from;         // farmer's phone number (digits, no '+')
    const msgId    = message.id;           // wamid — needed to mark as read
    const msgType  = message.type;         // 'text', 'image', 'audio', 'document', etc.

    if (!from) return;

    // Mark as read (shows blue ticks to farmer — good UX)
    markAsRead(msgId).catch(() => {});

    // ── Handle non-text messages ───────────────────────────────────
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

    // ── Process the message asynchronously ────────────────────────
    handleIncomingMessage(from, text).catch((err) => {
      console.error(`Unhandled error processing message from ${from}:`, err);
    });

  } catch (err) {
    console.error('Webhook parse error:', err);
  }
});

module.exports = router;
