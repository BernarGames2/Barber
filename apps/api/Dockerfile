# syntax=docker/dockerfile:1
# Imagem de produção da API do Barber Voice.
# Build a partir da RAIZ do monorepo:
#   docker build -f apps/api/Dockerfile -t barber-voice-api .
#
# Migrações NÃO rodam no boot da API: execute `pnpm db:migrate` (com DATABASE_ADMIN_URL)
# como etapa separada do deploy — ver docs/DEPLOYMENT.md.

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter "@barber-voice/api..."
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @barber-voice/api build \
 && pnpm --filter @barber-voice/api deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server.js"]
