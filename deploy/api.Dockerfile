# API (NestJS) : construite dans le monorepo, lancée après les migrations Prisma.
# docker build -f deploy/api.Dockerfile -t gestvente-api .

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /depot

FROM base AS construction
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY app/package.json app/
# Le code partagé se compile à l'installation (script prepare) : ses sources d'abord.
COPY packages/commun packages/commun
# Le client Prisma est généré à l'installation : le schéma doit être là.
COPY api/prisma api/prisma
COPY api/prisma.config.ts api/
RUN pnpm install --frozen-lockfile --filter "@gestvente/api..."
COPY api api
RUN pnpm --filter @gestvente/commun build \
  && pnpm --filter @gestvente/api exec prisma generate \
  && pnpm --filter @gestvente/api build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /depot
COPY --from=construction --chown=node:node /depot ./
WORKDIR /depot/api
RUN mkdir -p /donnees/stockage && chown -R node:node /donnees
USER node
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget -qO- http://127.0.0.1:3200/api/sante >/dev/null || exit 1
# Migrations en attente appliquées à chaque démarrage (sans effet si la base est à jour).
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
