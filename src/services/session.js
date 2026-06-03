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
    enableOfflineQueue: false,
  });

  redisClient.on('connect', () => console.log('✅ Redis connected'));
  redisClient.on('error', (err) => {
    console.warn('⚠️  Redis error (falling back to memory):', err.message);
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
  const TTL_SECONDS = 6 * 60 * 60; // 6 hours
  try {
    const client = getClient();
    await client.setex(key, TTL_SECONDS, payload);
  } catch {
    memStore.set(key, JSON.parse(payload), { ttl: TTL_SECONDS * 1000 });
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
 * Create a fresh session for a farmer implementing the 6-Step workflow.
 */
async function createSession(phoneNumber) {
  const session = {
    phoneNumber,
    farmId: null,
    farmCode: null,
    farmName: null,
    
    // Enriched metadata
    dbCache: { plots: [], allCrops: [], machines: [], employees: [], submittedToday: [] },
    
    // Queue for Multi-Farm Reporting
    pendingFarmsQueue: [],
    
    // LLM Orchestration State
    conversationPhase: 'COLLECTING', // 'COLLECTING' | 'REVIEW' | 'CONFIRMED'
    pendingTimeoutChoice: false,
    
    // Draft DTS
    draft_dts_state: [],
    draft_meta: {
      deviation_notes: null,
      next_day_plans: null,
      agronomy_report: null
    },
    
    // Confirmed DTS
    confirmed_dts_state: null,

    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
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
    if (memStore.has(key)) return false;
    memStore.set(key, '1', { ttl: 1000 * 60 * 60 });
    return true;
  }
}

async function acquireLock(phoneNumber) {
  const key = `lock:${phoneNumber}`;
  try {
    const client = getClient();
    const isNew = await client.set(key, '1', 'NX', 'EX', 60);
    return !!isNew;
  } catch {
    if (memStore.has(key)) return false;
    memStore.set(key, '1', { ttl: 60 * 1000 });
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
