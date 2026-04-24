# Deploying Quick Fix

## Overview

Two machines:
- **Hetzner CX33** (Cloud VM) — hosts Next.js + Redis + Caddy via Docker Compose
- **vast.ai GPU** instance — hosts the Python worker in a Docker container

Supabase is a managed service; no hosting needed.

---

## 1. Provision Supabase

Follow `supabase/README.md`:
1. Create project
2. Run migrations `0001_init.sql`, `0002_storage.sql`, `0003_rpc_credits.sql`
3. Create `images` bucket (private, 20 MB limit)
4. Schedule the 10-minute cleanup cron

## 2. Configure Stripe

1. Create products + prices in Stripe dashboard:
   - Pro subscription ($9/mo) → copy the price id into `STRIPE_PRICE_PRO`
   - Business subscription ($29/mo) → `STRIPE_PRICE_BUSINESS`
   - 100-credit pack ($5 one-off) → `STRIPE_PRICE_CREDITS_SMALL`
   - 1000-credit pack ($40 one-off) → `STRIPE_PRICE_CREDITS_LARGE`
2. Create a webhook endpoint → `https://YOUR_DOMAIN/api/stripe/webhook` with events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

## 3. Deploy Hetzner (Next.js + Redis + Caddy)

```bash
# On the Hetzner box, as root or with sudo:
apt update && apt install -y docker.io docker-compose-plugin git ufw

# Firewall: allow SSH, HTTP, HTTPS. Redis is restricted to the vast.ai IP.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow from <VAST_AI_PUBLIC_IP> to any port 6379 proto tcp
ufw --force enable

# Clone + configure
git clone https://github.com/<you>/quickfix.git /opt/quickfix
cd /opt/quickfix
cp .env.example .env
# Fill in .env with real Supabase + Stripe + REDIS_PASSWORD + DOMAIN values.
# Set DOMAIN=quickfix.yourdomain.com so Caddy picks it up.

docker compose up -d --build
docker compose logs -f web
```

Point your domain's A record at the Hetzner public IP. Caddy will obtain TLS automatically on first request.

## 4. Deploy vast.ai worker

On your local machine, build and push the worker image:

```bash
cd apps/worker
docker build -t <your-dockerhub>/quickfix-worker:latest .
docker push <your-dockerhub>/quickfix-worker:latest
```

On vast.ai, rent an instance with a modern NVIDIA GPU (RTX 4090 / 3090 / A100, ≥16 GB VRAM) and the **Docker** template. Use this startup command:

```bash
docker run -d --restart=unless-stopped \
  --gpus all \
  -e REDIS_URL="redis://:<REDIS_PASSWORD>@<HETZNER_PUBLIC_IP>:6379" \
  -e SUPABASE_URL="https://<YOUR_PROJECT>.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="<SERVICE_ROLE_KEY>" \
  -e WORKER_ID="vast-worker-1" \
  -e DEVICE="cuda" \
  -p 8000:8000 \
  <your-dockerhub>/quickfix-worker:latest
```

Health check: `curl http://<vast_ip>:8000/health` should return JSON.

## 5. Smoke test

1. Visit `https://YOUR_DOMAIN/`.
2. Drop an image → should return a transparent PNG in a few seconds.
3. Sign in at `/login`, then test the Stripe upgrade flow (use Stripe test card `4242 4242 4242 4242`).

## Ongoing ops

- **Logs**: `docker compose logs -f web` on Hetzner; `docker logs -f <container>` on vast.ai
- **Redis backup**: not needed — queue is ephemeral
- **Scaling GPU**: spin up a second vast.ai instance with a different `WORKER_ID`; both will BRPOP from the same queues
- **Updating web**: `git pull && docker compose up -d --build web`
- **Updating worker**: rebuild/push the image and `docker pull && docker restart` on vast.ai
