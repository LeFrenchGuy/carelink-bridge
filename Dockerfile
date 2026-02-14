FROM node:25-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN npm prune --production

COPY .env* ./

ENV NODE_ENV=production

HEALTHCHECK --interval=5m --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

CMD ["node", "dist/main.js"]
