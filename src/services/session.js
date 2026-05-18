/**
 * Session Service
 * Uses Redis for high-performance, concurrent session management.
 * Supports 600+ simultaneous farmer conversations with zero collision.
 * Falls back to in-memory store if Redis is unavailable (dev only).
 */

const Redis = require('ioredis');
const config = require('../config');
const { LRUCache } = require('lru-cache');

const SESSION_PREFIX = 'zetta:session:';
let redisClient = null;

// In-memory fallback for development without Redis (with TTL/Max bounds)
const memStore = new LRUCache({ max: 1000, ttl: 1000 * 60 * 60 * 24 });

function getClient() {
  if (redisClient) return redisClient;

  redisClient = new Redis(config.redis.url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 3000,
  });

  redisClient.on('connect', () => console.log('✅ Redis connected'));
  redisClient.on('error', (err) => {
    console.warn('⚠️  Redis error (falling back to memory):', err.message);
    // Keep ioredis instance so it tries reconnecting instead of spamming new maps/clients
  });

  return redisClient;
}

async function getSession(phoneNumber) {
  const key = `${SESSION_PREFIX}${phoneNumber}`;
  try {
    const client = getClient();
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return memStore.get(key) || null;
  }
}

async function setSession(phoneNumber, sessionData) {
  const key = `${SESSION_PREFIX}${phoneNumber}`;
  const payload = JSON.stringify({ ...sessionData, lastActivity: new Date().toISOString() });
  try {
    const client = getClient();
    await client.setex(key, config.redis.sessionTTL, payload);
  } catch {
    memStore.set(key, JSON.parse(payload));
  }
}

async function deleteSession(phoneNumber) {
  const key = `${SESSION_PREFIX}${phoneNumber}`;
  try {
    const client = getClient();
    await client.del(key);
  } catch {
    memStore.delete(key);
  }
}

/**
 * Create a fresh session for a farmer.
 * State machine: AWAITING_FARM_CODE → COLLECTING_DATA → COMPLETED
 */
async function createSession(phoneNumber) {
  const session = {
    phoneNumber,
    state: 'AWAITING_FARM_CODE',
    farmCode: null,
    farmName: null,
    conversationId: null,
    // DTS data buckets — filled progressively via AI extraction
    collectedData: {
      machineryUsage: [],   // Array of machinery entries
      harvest: [],          // Array of harvest entries
      reasonsForDeviation: null,
      nextDayPlans: null,
      agronomyReport: null,
      filledBy: null,
    },
    conversationHistory: [], // OpenAI message objects [{role, content}]
    turnCount: 0,
    createdAt: new Date().toISOString(),
  };

  await setSession(phoneNumber, session);
  return session;
}

/**
 * Marks a message as processed. Returns true if unique, false if duplicate.
 */
async function markMessageProcessed(msgId) {
  const key = `msg_seen:${msgId}`;
  try {
    const client = getClient();
    const isNew = await client.set(key, '1', 'NX', 'EX', 3600);
    return !!isNew;
  } catch {
    // Memory fallback
    if (memStore.has(key)) return false;
    memStore.set(key, '1', { ttl: 1000 * 60 * 60 });
    return true;
  }
}

/**
 * Acquire a lock for a phone number to prevent race conditions.
 */
async function acquireLock(phoneNumber) {
  const key = `lock:${phoneNumber}`;
  try {
    const client = getClient();
    const isNew = await client.set(key, '1', 'NX', 'EX', 15);
    return !!isNew;
  } catch {
    if (memStore.has(key)) return false;
    memStore.set(key, '1', { ttl: 15 * 1000 });
    return true;
  }
}

async function releaseLock(phoneNumber) {
  const key = `lock:${phoneNumber}`;
  try {
    const client = getClient();
    await client.del(key);
  } catch {
    memStore.delete(key);
  }
}

module.exports = { getSession, setSession, deleteSession, createSession, markMessageProcessed, acquireLock, releaseLock };
