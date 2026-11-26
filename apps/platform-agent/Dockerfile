# Lisna's voice agent, for LiveKit Cloud (`pnpm deploy:platform-agent`).
# Built from a staging folder that scripts/deploy.sh fills: src/, a package.json
# whose @outreach/core points at ./core, and core/ (its package.json + dist).
FROM node:22-slim

RUN apt-get update && apt-get install -y python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY core/ ./core/
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src/ ./src/

ENV NODE_ENV=production
CMD ["node", "src/agent.js", "start"]
