#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Zetta Farm Chatbot — 3-Contributor GitHub Push Script
#
#  This script makes 3 separate commits, each authored by a
#  different team member, so all three appear as contributors
#  on GitHub.
#
#  HOW TO RUN:
#    1. Open terminal in this folder (Zetta-Chatbot/)
#    2. Fill in your REPO_URL below (from Abhinav's GitHub)
#    3. Run:  bash push_contributors.sh
# ─────────────────────────────────────────────────────────────

set -e  # Stop on any error

# ── CONFIGURE THIS ────────────────────────────────────────────
REPO_URL="https://github.com/abhib05/Zetta-ChatBot.git"
# Example: "https://github.com/abhinavb/zetta-farm-chatbot.git"
# ─────────────────────────────────────────────────────────────

# Guard: make sure the user updated the URL
if [[ "$REPO_URL" == *"ABHINAV_USERNAME"* ]]; then
  echo ""
  echo "❌  Please edit push_contributors.sh and set your real REPO_URL first."
  echo "    Open the file, find line 20, and replace the URL with Abhinav's repo URL."
  echo ""
  exit 1
fi

echo ""
echo "🌾  Zetta Farm Chatbot — 3-Contributor Push"
echo "    Repo: $REPO_URL"
echo ""

# ── STEP 1: Initialize git ────────────────────────────────────
echo "▶  Initializing git repository..."
git init
git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"

# ── STEP 2: SURYA'S COMMIT ────────────────────────────────────
# Files: Project foundation — server, config, environment setup
echo ""
echo "▶  Commit 1/3 — Surya (Project Foundation)..."

git add \
  package.json \
  .env.example \
  .gitignore \
  Procfile

# Create src directories if not tracked yet
git add src/index.js
git add src/config/index.js

GIT_AUTHOR_NAME="Surya" \
GIT_AUTHOR_EMAIL="suryavritesh@gmail.com" \
GIT_COMMITTER_NAME="Surya" \
GIT_COMMITTER_EMAIL="suryavritesh@gmail.com" \
git commit -m "feat: project foundation — Express server, config, and environment setup

- Express server with helmet, morgan, rate limiting
- Centralised config with startup validation
- Environment variable template (.env.example)
- Procfile for Railway deployment"

echo "   ✅  Surya's commit done"

# ── STEP 3: ACHYUTH'S COMMIT ─────────────────────────────────
# Files: All service layer — WhatsApp API, OpenAI, Supabase, Redis sessions
echo ""
echo "▶  Commit 2/3 — Achyuth (Services Layer)..."

git add \
  src/services/whatsapp.js \
  src/services/openai.js \
  src/services/supabase.js \
  src/services/session.js

GIT_AUTHOR_NAME="Achyuth" \
GIT_AUTHOR_EMAIL="achyuthchamarthi@gmail.com" \
GIT_COMMITTER_NAME="Achyuth" \
GIT_COMMITTER_EMAIL="achyuthchamarthi@gmail.com" \
git commit -m "feat: core services — WhatsApp Business API, OpenAI GPT-4, Supabase, Redis sessions

- Meta WhatsApp Cloud API integration with markAsRead support
- OpenAI GPT-4 conversation engine with structured SAVE_DATA extraction
- Supabase service for DTS submissions, machinery, and harvest records
- Redis-backed session management with in-memory fallback (600 farmers/day)"

echo "   ✅  Achyuth's commit done"

# ── STEP 4: ABHINAV'S COMMIT ─────────────────────────────────
# Files: Conversation logic, webhook routing, DB schema, docs
echo ""
echo "▶  Commit 3/3 — Abhinav (Core Logic, Database & Docs)..."

git add \
  src/routes/webhook.js \
  src/handlers/conversation.js \
  schema/supabase.sql \
  sample-data/seed.sql \
  SETUP.md

GIT_AUTHOR_NAME="Abhinav" \
GIT_AUTHOR_EMAIL="abhinavbotlaguduru@gmail.com" \
GIT_COMMITTER_NAME="Abhinav" \
GIT_COMMITTER_EMAIL="abhinavbotlaguduru@gmail.com" \
git commit -m "feat: conversation state machine, webhook routing, DB schema, and setup guide

- Meta webhook handler (GET verify + POST messages)
- Conversation state machine: AWAITING_FARM_CODE → COLLECTING_DATA → COMPLETED
- Duplicate submission detection and graceful exit phrase handling
- Full Supabase schema: farms, dts_submissions, machinery_usage, harvest_records
- 5 sample farm codes (ZF-001 to ZF-005) seed data
- Step-by-step SETUP.md for full Meta + Railway deployment"

echo "   ✅  Abhinav's commit done"

# ── STEP 5: PUSH ─────────────────────────────────────────────
echo ""
echo "▶  Pushing all 3 commits to GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "────────────────────────────────────────────────"
echo "✅  All done! All 3 contributors pushed to:"
echo "    $REPO_URL"
echo ""
echo "    Go to GitHub → your repo → Insights → Contributors"
echo "    You should see Surya, Achyuth, and Abhinav listed."
echo ""
echo "    ⚠️  If someone is missing, their GitHub account email"
echo "    may differ from the one used here. See the note below."
echo "────────────────────────────────────────────────"
echo ""
echo "NOTE: GitHub credits contributions by matching the commit"
echo "email to a verified email in each person's GitHub account."
echo "Each person should check: GitHub → Settings → Emails"
echo "and make sure their email matches what's in this script."
echo ""
