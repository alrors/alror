# Alror workspace (website, console and /api/v1). Build: docker build -t alror-web .
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# drizzle-kit (for migrations on start) lives in devDependencies, so keep the full node_modules.
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then serve.
CMD ["sh", "-c", "node node_modules/drizzle-kit/bin.cjs migrate && exec node_modules/.bin/next start -p 3000"]
