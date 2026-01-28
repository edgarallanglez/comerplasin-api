FROM debian:12-slim

RUN apt-get update && apt-get install -y curl ca-certificates gnupg iproute2 && rm -rf /var/lib/apt/lists/*

# Instala zerotier-one (script oficial)
RUN curl -s https://install.zerotier.com | bash

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/var/lib/zerotier-one"]
ENTRYPOINT ["/entrypoint.sh"]