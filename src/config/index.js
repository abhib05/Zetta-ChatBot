require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Meta WhatsApp Business API (Cloud API)
  whatsapp: {
    accessToken:   process.env.WHATSAPP_ACCESS_TOKEN,   // Permanent System User token
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID, // Phone Number ID from Meta app
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID, // WABA ID (for reference)
    verifyToken:   process.env.WHATSAPP_VERIFY_TOKEN,   // Your custom webhook verify string
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    // Free OpenRouter model — see https://openrouter.ai/models?q=free
    model: process.env.OPENAI_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    sessionTTL: parseInt(process.env.SESSION_TTL_SECONDS) || 86400, // 24 hours
  },

  conversation: {
    maxTurns: parseInt(process.env.MAX_CONVERSATION_TURNS) || 40,
  },
};

// Validate required env vars on startup
function validate() {
  const required = [
    ['WHATSAPP_ACCESS_TOKEN',    config.whatsapp.accessToken],
    ['WHATSAPP_PHONE_NUMBER_ID', config.whatsapp.phoneNumberId],
    ['WHATSAPP_VERIFY_TOKEN',    config.whatsapp.verifyToken],
    ['OPENAI_API_KEY',           config.openai.apiKey],
    ['SUPABASE_URL',             config.supabase.url],
    ['SUPABASE_SERVICE_KEY',     config.supabase.serviceKey],
  ];

  const missing = required.filter(([, val]) => !val).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  console.log('✅ Config validated successfully');
}

module.exports = { ...config, validate };
