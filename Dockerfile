FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

# /data holds state.json (what was already alerted). Owned by `node` so a named volume is writable.
RUN mkdir -p /data /config && chown node:node /data

ENV NODE_ENV=production \
    STATUSBOT_CONFIG=/config/services.json \
    STATUSBOT_STATE=/data/state.json

USER node
VOLUME ["/data"]
ENTRYPOINT ["node", "src/main.ts"]
