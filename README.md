# Quick Fix

Freemium online tools. First product: AI background removal powered by BiRefNet.

## Architecture

```
apps/web       Next.js 15 App Router — landing, dashboard, billing, API
apps/worker    Python + FastAPI + BiRefNet — GPU inference on vast.ai
supabase/      SQL migrations and seed data
```

## Stack

- Frontend / API: **Next.js 15** on Hetzner (Docker + Caddy)
- Auth / DB / Object Storage: **Supabase**
- Payments: **Stripe** (subscriptions + credit packs)
- Queue: **Redis** (self-hosted on Hetzner)
- GPU: **vast.ai** running Python worker
- Model: **BiRefNet** (MIT) — optional ViTMatte refinement for paid tier

## Local development

```bash
# web
cd apps/web
cp .env.local.example .env.local   # fill in Supabase + Stripe keys
pnpm install
pnpm dev

# worker (CPU fallback for local dev)
cd apps/worker
cp .env.example .env
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

## Deploy

See `deploy/README.md`.
