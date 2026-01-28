#!/usr/bin/env bash
set -e

# Arranca zerotier-one en background
zerotier-one -d

# Espera a que el daemon responda
echo "Waiting for zerotier-one..."
for i in $(seq 1 30); do
  if zerotier-cli status >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "ZeroTier status:"
zerotier-cli status || true

if [ -n "${ZT_NETWORK_ID:-}" ]; then
  echo "Joining network: $ZT_NETWORK_ID"
  zerotier-cli join "$ZT_NETWORK_ID" || true
fi

echo "Networks:"
zerotier-cli listnetworks || true

# Mantén el contenedor vivo
tail -f /dev/null
