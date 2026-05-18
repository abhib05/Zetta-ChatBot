# Zetta Farm WhatsApp Chatbot — Setup & Deployment Guide

This guide walks you through setting up the entire system from scratch.
Estimated time: **60–75 minutes**.

---

## What You're Building

```
Farmer WhatsApp  →  Meta Cloud API  →  Your Server (Node.js)  →  OpenAI GPT-4
                                               ↓
                                          Supabase DB
                                          (PostgreSQL)
```

- **Meta WhatsApp Business API (Cloud API)** — receives farmer messages and delivers your bot's replies directly, with no middleman.
- **Node.js server** — manages conversation state per farmer.
- **OpenAI GPT-4** — understands natural language and extracts DTS fields.
- **Supabase** — stores all submitted DTS data.
- **Redis** — keeps session state for 600 parallel conversations.

---

## Prerequisites

Make sure you have these accounts ready before starting:

| Service | Free Tier | URL |
|---------|-----------|-----|
| Meta for Developers | Yes | https://developers.facebook.com |
| Meta Business Suite | Yes | https://business.facebook.com |
| OpenAI | Paid (API credits needed) | https://platform.openai.com |
| Supabase | Yes | https://supabase.com |
| Railway | Yes | https://railway.app |
| GitHub | Yes | https://github.com |

You also need **Node.js 18+** installed locally.

---

## STEP 1 — Clone / Download the Project

If you have Git:
```bash
git clone <your-repo-url>
cd Zetta-Chatbot
```

Or simply copy the `Zetta-Chatbot` folder to your machine.

Then install dependencies:
```bash
npm install
```

---

## STEP 2 — Set Up Supabase (Database)

### 2a. Create a Supabase Project

1. Go to https://supabase.com and sign in.
2. Click **New Project**.
3. Fill in:
   - **Project name**: `zetta-farms`
   - **Database password**: Choose a strong password and save it.
   - **Region**: Choose closest to India (Mumbai `ap-south-1` if available, else Singapore).
4. Click **Create new project** and wait ~2 minutes.

### 2b. Run the Database Schema

1. In your Supabase project, click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Copy the entire contents of `schema/supabase.sql` and paste it in.
4. Click **Run** (Ctrl+Enter). You should see: `Success. No rows returned`.

### 2c. Seed Sample Farm Codes

1. In SQL Editor, click **New query**.
2. Copy the contents of `sample-data/seed.sql` and paste it.
3. Click **Run**. You should see 5 rows:

```
ZF-001  Sunrise Agro Farm       Rajesh Patil   45.50
ZF-002  Green Valley Estate     Suresh Kumar   78.00
ZF-003  Harvest Moon Fields     Priya Desai    32.75
ZF-004  Golden Acres Farm       Mohan Singh    120.00
ZF-005  River Bend Organics     Anita Jadhav   55.25
```

### 2d. Get Your Supabase Credentials

1. Go to **Project Settings → API**.
2. Copy and save:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key → `SUPABASE_SERVICE_KEY`

> Never expose the `service_role` key in frontend code or commit it to Git.

---

## STEP 3 — Set Up OpenAI

1. Go to https://platform.openai.com/api-keys.
2. Click **Create new secret key**, name it `zetta-chatbot`.
3. Copy the key immediately (shown only once).
4. Ensure billing is enabled and you have API credits.
   - GPT-4 Turbo at 600 farmers/day ≈ $15–30/day.
   - Switch to `gpt-3.5-turbo` in `.env` for ~$2–5/day with some accuracy trade-off.

---

## STEP 4 — Set Up Meta WhatsApp Business API

This is the most involved step. Follow carefully.

### 4a. Create a Meta Developer Account & App

1. Go to https://developers.facebook.com and log in with your Facebook account.
2. Click **My Apps → Create App**.
3. Select **Business** as the app type.
4. Fill in:
   - **App name**: `Zetta Farm Chatbot`
   - **App contact email**: your email
   - **Business account**: Select your business or create one
5. Click **Create App**.

### 4b. Add WhatsApp to Your App

1. On your app dashboard, scroll down to find **WhatsApp** and click **Set up**.
2. You'll be taken to the **WhatsApp Getting Started** page.
3. Under **Step 1 — Select a phone number**, you'll see a free test number provided by Meta. Note this number — it's for testing.
4. Under **Step 2 — Send and receive messages**, you'll see:
   - **Phone Number ID** → copy this → `WHATSAPP_PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID** → copy this → `Zetta Farm Chatbot`

### 4c. Generate a Permanent Access Token

The temporary token on the Getting Started page expires in 24 hours. You need a permanent one.

1. Go to https://business.facebook.com.
2. Click **Settings** (gear icon, bottom-left) → **Business Settings**.
3. In the left sidebar, click **Users → System Users**.
4. Click **Add** to create a new system user:
   - **System username**: `zetta-chatbot`
   - **System user role**: Admin
5. Click **Create System User**.
6. On the system user page, click **Generate New Token**.
7. Select your app (`Zetta Farm Chatbot`) from the dropdown.
8. Under **Available Permissions**, enable:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
9. Click **Generate Token**.
10. Copy the token immediately → this is your `WHATSAPP_ACCESS_TOKEN`.

> This token does NOT expire. Keep it secret — treat it like a password.

### 4d. Add Your Phone Number (Production)

For real farmers, you need a verified business phone number (not the test number).

1. In your Meta App, go to **WhatsApp → Phone Numbers**.
2. Click **Add phone number**.
3. Enter the phone number you want farmers to message.
4. Verify it via SMS or voice call.
5. Once verified, this number's **Phone Number ID** replaces the test one in your `.env`.

> The test number is fine for development and demo. Use it first, then switch.

### 4e. Set Your Webhook Verify Token

Choose any secret string for your webhook. Example: `zetta_farms_webhook_2024`
Save this — you'll use it in `.env` as `WHATSAPP_VERIFY_TOKEN` and also enter it in Meta's dashboard in Step 8.

---

## STEP 5 — Set Up Redis

Redis manages conversation sessions for 600 concurrent farmers.

### Option A: Upstash Redis (Recommended — free tier)

1. Go to https://upstash.com and sign up.
2. Click **Create Database**.
3. Settings:
   - **Name**: `zetta-sessions`
   - **Type**: Regional
   - **Region**: `ap-south-1` (Mumbai) or closest to your server
4. Click **Create**.
5. Copy the **Redis URL** (looks like `redis://default:PASSWORD@HOSTNAME:PORT`).
6. This is your `REDIS_URL`.

### Option B: Railway Redis (if deploying on Railway)

Skip this step — Railway will provide Redis as an add-on (see Step 7).

---

## STEP 6 — Configure Environment Variables

1. Copy the example file:
```bash
cp .env.example .env
```

2. Open `.env` and fill in all values:

```env
PORT=3000
NODE_ENV=production

WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=1234567890123456
WHATSAPP_BUSINESS_ACCOUNT_ID=9876543210987654
WHATSAPP_VERIFY_TOKEN=zetta_farms_webhook_2024

OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4-turbo-preview

SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxx

REDIS_URL=redis://default:password@host:port
```

3. Test locally:
```bash
npm run dev
```

You should see:
```
✅ Config validated successfully
✅ Redis connected
🌾 Zetta Farm Chatbot started
   Port    : 3000
   Env     : production
   Webhook : POST /webhook/whatsapp
   Health  : GET  /health
```

---

## STEP 7 — Deploy to Railway

### 7a. Push Code to GitHub

1. Create a new private GitHub repository.
2. Push your code:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/zetta-chatbot.git
git push -u origin main
```

> `.env` is already in `.gitignore`. Never push your secrets.

### 7b. Deploy on Railway

1. Go to https://railway.app and sign in with GitHub.
2. Click **New Project → Deploy from GitHub repo**.
3. Select your `zetta-chatbot` repository.
4. Railway auto-detects Node.js and starts deploying.

### 7c. Add Redis on Railway

1. In your Railway project, click **New → Database → Add Redis**.
2. Railway creates a Redis instance and injects `REDIS_URL` automatically.

### 7d. Add Environment Variables

1. Click on your Node.js service → **Variables** tab.
2. Use the **Raw Editor** button and paste all your `.env` contents at once.
3. Click **Update Variables**. Railway will redeploy automatically.

### 7e. Get Your Public URL

1. Click on your service → **Settings** tab.
2. Under **Domains**, click **Generate Domain**.
3. Copy the URL — e.g., `https://zetta-chatbot-production.up.railway.app`

---

## STEP 8 — Connect Meta Webhook to Your Server

This step links Meta's servers to your deployed chatbot.

### 8a. Register Your Webhook in Meta App Dashboard

1. Go to https://developers.facebook.com → Your App → **WhatsApp → Configuration**.
2. Under **Webhook**, click **Edit**.
3. Fill in:
   - **Callback URL**: `https://YOUR-RAILWAY-URL.up.railway.app/webhook/whatsapp`
   - **Verify token**: The same string you set as `WHATSAPP_VERIFY_TOKEN` (e.g., `zetta_farms_webhook_2024`)
4. Click **Verify and Save**.
   - Meta will make a GET request to your server with a challenge.
   - Your server will respond with the challenge if the token matches.
   - You should see a green checkmark.

### 8b. Subscribe to Message Events

1. After verifying, you'll see a list of webhook fields.
2. Find **messages** and click **Subscribe**.
3. This tells Meta to forward all incoming WhatsApp messages to your webhook.

### 8c. Assign Webhook to Your Phone Number

1. Go to **WhatsApp → Configuration → Phone Numbers**.
2. Select your phone number and make sure it's linked to the webhook.

---

## STEP 9 — Test the WhatsApp Number

1. Open WhatsApp on your phone.
2. Send any message to the Meta test number (or your verified business number).
3. You should receive: `Welcome to Zetta Farms Daily Reporting! Please send your Farm Code...`

> For the Meta test number, you can only message it from numbers you've added as test users. Go to **App Dashboard → Roles → Test Users** and add your number.

---

## STEP 10 — Test End-to-End

Send these messages in sequence:

```
You:   Hello
Bot:   Welcome to Zetta Farms Daily Reporting! Please send your Farm Code to begin. Example: ZF-001

You:   ZF-001
Bot:   Farm verified: Sunrise Agro Farm. Good morning! Tell me what activities were carried out today.

You:   Today we did ploughing on plot A1, sugarcane, 5 acres, used tractor, 3 hours 30 mins, 20 litres fuel
Bot:   Got it! Ploughing on Plot A1, Sugarcane, 5 acres, Tractor, 3h 30m, 20L fuel. Any other machinery work today?

You:   No. Also harvested rice on plot B2, 2 acres, cycle 3, manual, 500 kg, 10 workers, 4 hours
Bot:   Harvest recorded! Plot B2, Rice, 2 acres, Cycle 3, Manual, 500kg, 10 workers, 4h. Any expense details?

You:   Labour expense, 5000 rupees
Bot:   Noted. Were there any deviations from today's plan?

You:   No deviations
Bot:   What are the plans for tomorrow?

You:   Irrigation on plots C1 and C2
Bot:   Any crop health or agronomy observations today?

You:   Crops look healthy, no pests observed
Bot:   Who is filling this report?

You:   Rajesh
Bot:   Here is your DTS summary: [summary]. Shall I submit?

You:   Yes submit
Bot:   Daily Task Sheet Submitted! Farm: Sunrise Agro Farm, Date: 03/04/2026, Reference: XXXXXXXX. Thank you! Have a good evening.
```

---

## STEP 11 — Add Your Real Farm Codes

Run SQL in Supabase SQL Editor to add more farms:

```sql
INSERT INTO farms (farm_code, farm_name, location, owner_name, total_acres)
VALUES ('ZF-006', 'Your Farm Name', 'City, State', 'Owner Name', 50.0);
```

For bulk import, export your farm list as CSV and use Supabase's **Table Editor → Import CSV**.

---

## Scaling: How 600 Farmers/Day is Handled

| Component | How it scales |
|-----------|--------------|
| **Node.js** | Event loop handles thousands of concurrent I/O operations without blocking |
| **Redis** | Sub-millisecond in-memory session reads — each farmer's state is fully isolated by phone number |
| **Meta Cloud API** | Meta's infrastructure handles delivery at any scale — no rate limit issues for inbound |
| **Supabase** | PostgreSQL + PgBouncer connection pooling handles hundreds of concurrent writes |
| **OpenAI** | ~1 API call per message turn; 600 farmers × 8 turns = ~4,800 calls/day |
| **Railway** | Auto-scales horizontally on CPU spikes |

Expected peak: ~50–80 simultaneous conversations (if all 600 farmers report within a 2-hour window).

---

## Monitoring & Troubleshooting

### View Logs
Railway → Your service → **Logs** tab. Filter by `ERROR` to surface issues.

### View Submissions in Supabase
```sql
SELECT * FROM v_daily_summary
WHERE submission_date = CURRENT_DATE
ORDER BY submitted_at DESC;
```

### Find Farms That Haven't Submitted Today
```sql
SELECT * FROM v_missing_submissions_today;
```

### Common Issues

**Bot not responding:**
- Check Railway logs for errors.
- Verify the webhook URL in Meta App Dashboard matches your Railway URL exactly.
- Make sure `messages` webhook field is subscribed (Step 8b).
- Try the health check: `curl https://YOUR-URL.railway.app/health`

**Webhook verification failing (Step 8a):**
- Ensure `WHATSAPP_VERIFY_TOKEN` in Railway matches what you entered in Meta exactly (case-sensitive).
- Make sure your server is deployed and running before clicking Verify.

**"Farm code not found" error:**
- Confirm you ran `sample-data/seed.sql` in Supabase.
- Farm codes are case-insensitive — `zf-001` will match `ZF-001`.

**Messages from your phone not reaching the bot (test number):**
- Add your phone number as a test user in Meta App Dashboard → Roles → Test Users.

**Redis connection error:**
- The app falls back to in-memory sessions in development.
- In production, verify `REDIS_URL` is set correctly in Railway Variables.

**OpenAI errors:**
- Verify API key is active and billing is enabled.
- If hitting rate limits, add a short retry with exponential backoff.

---

## Cost Estimate (600 farmers/day)

| Service | Usage | Cost/month |
|---------|-------|------------|
| OpenAI GPT-4 Turbo | ~4,800 API calls/day × 30 days | ~$450–600 |
| OpenAI GPT-3.5 Turbo | Alternative, lower accuracy | ~$30–50 |
| Meta WhatsApp API | First 1,000 conversations/month free, then ~$0.005–0.009/msg (India) | ~$50–80 |
| Railway (Hobby) | Always-on Node.js + Redis | ~$10 |
| Supabase (Free) | Well within free tier for 600 rows/day | $0 |
| Upstash Redis | Well within free tier | $0 |
| **Total (GPT-4)** | | **~$510–690/month** |
| **Total (GPT-3.5)** | | **~$90–140/month** |

> Meta WhatsApp pricing: The first 1,000 user-initiated conversations each month are free. After that, India rates are among the lowest globally.

---

## File Structure Reference

```
Zetta-Chatbot/
├── src/
│   ├── index.js                   # Express server entry point
│   ├── config/index.js            # All environment config + validation
│   ├── routes/webhook.js          # GET (verify) + POST (messages) for Meta
│   ├── services/
│   │   ├── whatsapp.js            # Meta Cloud API — sendMessage, markAsRead
│   │   ├── openai.js              # GPT-4 conversation + SAVE_DATA extraction
│   │   ├── supabase.js            # Database reads/writes
│   │   └── session.js             # Redis session management
│   └── handlers/
│       └── conversation.js        # State machine: farm code → collect → save
├── schema/supabase.sql            # Full DB schema (run once in Supabase)
├── sample-data/seed.sql           # 5 sample farm codes
├── .env.example                   # Template for all environment variables
├── .gitignore
├── package.json
├── Procfile                       # Railway/Heroku start command
└── SETUP.md                       # This file
```
