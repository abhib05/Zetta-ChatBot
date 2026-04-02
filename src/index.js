/**
 * Zetta Farm WhatsApp Chatbot
 * Entry point — Express server setup.
 *
 * Architecture for 600 farmers/day:
 *  - Node.js event loop handles high concurrency natively
 *  - Each request responds immediately (async processing)
 *  - Redis handles session state for all concurrent conversations
 *  - Supabase handles concurrent DB writes with connection pooling
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

// Validate config before starting
const config = require('./config');
try {
  config.validate();
} catch (err) {
  console.error('❌ Configuration error:', err.message);
  process.exit(1);
}

const webhookRouter = require('./routes/webhook');

const app = express();

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────

// Security headers
app.use(helmet());

// Request logging (combined format for production, dev for local)
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// Parse Twilio's URL-encoded form data
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Rate limiting
// Twilio sends from a small set of IPs, so we use a generous limit.
// This protects against malicious direct-POST attacks.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute window
  max: 2000,                   // 2000 req/min ≈ 33 req/sec (well above 600 farmers)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
});

app.use('/webhook', webhookLimiter);

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

app.use('/webhook', webhookRouter);

// Health check — used by Railway/Render for uptime monitoring
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'zetta-farm-chatbot',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    env: config.nodeEnv,
  });
});

// 404 catch-all
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

const PORT = config.port;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌾 Zetta Farm Chatbot started`);
  console.log(`   Port    : ${PORT}`);
  console.log(`   Env     : ${config.nodeEnv}`);
  console.log(`   Webhook : POST /webhook/whatsapp`);
  console.log(`   Health  : GET  /health\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received — shutting down gracefully');
  process.exit(0);
});

module.exports = app; // for testing
