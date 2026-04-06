# ─────────────────────────────────────────────────────────────
#  Zetta Farm Chatbot — 3-Contributor GitHub Push (PowerShell)
#
#  HOW TO RUN:
#    1. Open this file and paste your repo URL on line 17
#    2. In PowerShell (in this folder), run:
#         .\push_contributors.ps1
#    3. If you get a permissions error, first run:
#         Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# ── CONFIGURE THIS ────────────────────────────────────────────
$REPO_URL = "https://github.com/abhib05/Zetta-ChatBot.git"
# Example: "https://github.com/abhinavb/zetta-farm-chatbot.git"
# ─────────────────────────────────────────────────────────────

if ($REPO_URL -like "*ABHINAV_USERNAME*") {
    Write-Host ""
    Write-Host "❌  Please open push_contributors.ps1 and set your real REPO_URL on line 17." -ForegroundColor Red
    Write-Host "    Replace the placeholder with Abhinav's actual GitHub repo URL." -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "🌾  Zetta Farm Chatbot — 3-Contributor Push" -ForegroundColor Green
Write-Host "    Repo: $REPO_URL"
Write-Host ""

# ── STEP 1: Initialize git ────────────────────────────────────
Write-Host "▶  Initializing git repository..." -ForegroundColor Cyan
git init
git remote add origin $REPO_URL 2>$null
if ($LASTEXITCODE -ne 0) { git remote set-url origin $REPO_URL }

# ── STEP 2: SURYA'S COMMIT ────────────────────────────────────
Write-Host ""
Write-Host "▶  Commit 1/3 — Surya (Project Foundation)..." -ForegroundColor Cyan

git add package.json .env.example .gitignore Procfile src/index.js src/config/index.js

$env:GIT_AUTHOR_NAME     = "Surya"
$env:GIT_AUTHOR_EMAIL    = "suryavritesh@gmail.com"
$env:GIT_COMMITTER_NAME  = "Surya"
$env:GIT_COMMITTER_EMAIL = "suryavritesh@gmail.com"

git commit -m "feat: project foundation -- Express server, config, and environment setup"

Remove-Item Env:GIT_AUTHOR_NAME, Env:GIT_AUTHOR_EMAIL, Env:GIT_COMMITTER_NAME, Env:GIT_COMMITTER_EMAIL
Write-Host "   ✅  Surya's commit done" -ForegroundColor Green

# ── STEP 3: ACHYUTH'S COMMIT ─────────────────────────────────
Write-Host ""
Write-Host "▶  Commit 2/3 — Achyuth (Services Layer)..." -ForegroundColor Cyan

git add src/services/whatsapp.js src/services/openai.js src/services/supabase.js src/services/session.js

$env:GIT_AUTHOR_NAME     = "Achyuth"
$env:GIT_AUTHOR_EMAIL    = "achyuthchamarthi@gmail.com"
$env:GIT_COMMITTER_NAME  = "Achyuth"
$env:GIT_COMMITTER_EMAIL = "achyuthchamarthi@gmail.com"

git commit -m "feat: core services -- WhatsApp Business API, OpenAI GPT-4, Supabase, Redis sessions"

Remove-Item Env:GIT_AUTHOR_NAME, Env:GIT_AUTHOR_EMAIL, Env:GIT_COMMITTER_NAME, Env:GIT_COMMITTER_EMAIL
Write-Host "   ✅  Achyuth's commit done" -ForegroundColor Green

# ── STEP 4: ABHINAV'S COMMIT ─────────────────────────────────
Write-Host ""
Write-Host "▶  Commit 3/3 — Abhinav (Core Logic, Database & Docs)..." -ForegroundColor Cyan

git add src/routes/webhook.js src/handlers/conversation.js schema/supabase.sql sample-data/seed.sql SETUP.md

$env:GIT_AUTHOR_NAME     = "Abhinav"
$env:GIT_AUTHOR_EMAIL    = "abhinavbotlaguduru@gmail.com"
$env:GIT_COMMITTER_NAME  = "Abhinav"
$env:GIT_COMMITTER_EMAIL = "abhinavbotlaguduru@gmail.com"

git commit -m "feat: conversation state machine, webhook routing, DB schema, and setup guide"

Remove-Item Env:GIT_AUTHOR_NAME, Env:GIT_AUTHOR_EMAIL, Env:GIT_COMMITTER_NAME, Env:GIT_COMMITTER_EMAIL
Write-Host "   ✅  Abhinav's commit done" -ForegroundColor Green

# ── STEP 5: PUSH ─────────────────────────────────────────────
Write-Host ""
Write-Host "▶  Pushing all 3 commits to GitHub..." -ForegroundColor Cyan
git branch -M main
git push -u origin main

Write-Host ""
Write-Host "────────────────────────────────────────────────" -ForegroundColor Green
Write-Host "✅  All done! Check your repo on GitHub." -ForegroundColor Green
Write-Host "    Go to: Insights → Contributors"
Write-Host "    You should see Surya, Achyuth, and Abhinav listed."
Write-Host "────────────────────────────────────────────────" -ForegroundColor Green
Write-Host ""
