FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

# /data holds state.json (what was already alerted) and chats.json (who may use the bot). Owned by
# `node` so a named volume is writable.
RUN mkdir -p /data /config && chown node:node /data

ENV NODE_ENV=production \
    STATUSBOT_CONFIG=/config/services.json \
    STATUSBOT_STATE=/data/state.json \
    HTTP_HOST=0.0.0.0

# HTTP_HOST=0.0.0.0: inside the container, localhost is unreachable from the host. Without HTTP_TOKEN,
# publish the port on the host's localhost only (see compose.yaml).
USER node
VOLUME ["/data"]
ENTRYPOINT ["node", "src/main.ts"]
