FROM node:18-alpine

LABEL maintainer="Pharos Skill Builder"
LABEL description="Pharos Cross-Chain RWA Distribution Oracle"

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
