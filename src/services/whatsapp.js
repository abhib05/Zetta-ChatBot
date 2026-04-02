/**
 * WhatsApp Service — Meta Cloud API (WhatsApp Business API)
 *
 * Uses the official Meta Graph API to send messages.
 * No third-party SDK required — uses Node.js 18+ native fetch.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 */

const config = require('../config');

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Send a plain text WhatsApp message to a farmer.
 *
 * @param {string} to   - Recipient phone number in E.164 format (e.g. 919876543210)
 *                        WITHOUT the '+' prefix — Meta requires digits only.
 * @param {string} body - Message text (plain text, max ~4096 chars)
 */
async function sendMessage(to, body) {
  // Strip any non-digit prefix characters (e.g. '+', 'whatsapp:')
  const recipientNumber = to.replace(/[^\d]/g, '');

  const url = `${GRAPH_API_BASE}/${config.whatsapp.phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientNumber,
    type: 'text',
    text: {
      preview_url: false,
      body,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`❌ Meta API error [${res.status}] to ${recipientNumber}: ${errBody}`);
    throw new Error(`Meta API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const msgId = data?.messages?.[0]?.id || '(no id)';
  console.log(`📤 Sent to ${recipientNumber} [${msgId}]: ${body.slice(0, 60)}...`);
  return data;
}

/**
 * Mark an incoming message as "read" (shows double blue ticks to farmer).
 * Call this after receiving a message — improves UX.
 *
 * @param {string} messageId - The wamid from the incoming webhook payload
 */
async function markAsRead(messageId) {
  const url = `${GRAPH_API_BASE}/${config.whatsapp.phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Non-critical — don't throw, just log
    console.warn(`⚠️  Could not mark message ${messageId} as read:`, err.message);
  }
}

/**
 * Send a long message split into WhatsApp-safe chunks.
 * Meta allows up to 4096 chars per message, but shorter is better UX.
 *
 * @param {string} to
 * @param {string} body
 */
async function sendLongMessage(to, body) {
  const CHUNK_SIZE = 1500;
  if (body.length <= CHUNK_SIZE) {
    return sendMessage(to, body);
  }

  const chunks = [];
  for (let i = 0; i < body.length; i += CHUNK_SIZE) {
    chunks.push(body.slice(i, i + CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    await sendMessage(to, chunk);
    await new Promise((r) => setTimeout(r, 300));
  }
}

module.exports = { sendMessage, sendLongMessage, markAsRead };
