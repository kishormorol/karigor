#!/usr/bin/env bash
# Turns a fresh Ubuntu server (an Oracle Cloud "Always Free" Ampere machine works) into a public
# Karigor: people sign up in the browser, build by chatting, and use their apps at their own addresses.
#
#   curl -fsSL https://raw.githubusercontent.com/kishormorol/karigor/main/hosting/setup.sh | bash
#
# Without a domain it uses <your-ip>.sslip.io, which needs nothing set up. With one, point
# karigor.example.com and *.apps.example.com at this server, then run:
#   KARIGOR_DOMAIN=karigor.example.com KARIGOR_APPS_DOMAIN=apps.example.com bash setup.sh
# Running it again updates Karigor and keeps everyone's projects.
set -euo pipefail

DIR=/opt/karigor
MODEL=${KARIGOR_OLLAMA_MODEL:-qwen2.5:7b}

echo "==> Installing Docker and git"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; fi
command -v git >/dev/null || sudo apt-get install -y git

echo "==> Opening the web ports (Oracle's Ubuntu images block them in the firewall too)"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi

echo "==> Getting Karigor"
if [ -d "$DIR/.git" ]; then sudo git -C "$DIR" pull --ff-only; else sudo git clone https://github.com/kishormorol/karigor "$DIR"; fi
cd "$DIR/hosting"

if [ ! -f .env ]; then
  ip=$(curl -fsS https://api.ipify.org)
  base="${ip//./-}.sslip.io"
  domain=${KARIGOR_DOMAIN:-karigor.$base}
  apps=${KARIGOR_APPS_DOMAIN:-$base}
  sudo tee .env >/dev/null <<ENV
KARIGOR_TOKEN=$(openssl rand -hex 24)
KARIGOR_DOMAIN=$domain
KARIGOR_APPS_DOMAIN=$apps
KARIGOR_SIGNUP=open
KARIGOR_OLLAMA_MODEL=$MODEL
ENV
  sudo chmod 600 .env
fi
set -a; . <(sudo cat .env); set +a

echo "==> Building and starting (the first build takes several minutes)"
sudo docker compose up -d --build

echo "==> Downloading the free AI model ($MODEL, a few GB)"
sudo docker compose exec -T ollama ollama pull "$MODEL"

cat <<DONE

Karigor is running.

  Everyone:  https://$KARIGOR_DOMAIN
             (they sign up with a name and build; their apps appear at https://a<number>.$KARIGOR_APPS_DOMAIN)

  You:       https://$KARIGOR_DOMAIN/?token=$KARIGOR_TOKEN
             (sees every project and manages People; keep it private)

The first visit can take a minute while the secure certificate is made.
DONE
