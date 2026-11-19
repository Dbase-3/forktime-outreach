# The outreach voice agent, for LiveKit Cloud (`pnpm deploy:agent`).
# The build context is apps/agent: this package has no workspace dependencies.
FROM node:22-slim

RUN apt-get update && apt-get install -y python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src/ ./src/

ENV NODE_ENV=production
CMD ["node", "src/agent.js", "start"]
