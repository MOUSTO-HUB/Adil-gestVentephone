# Site installable (export web d'Expo) servi par Caddy, qui relaie aussi /api vers l'API.
# docker build -f deploy/web.Dockerfile -t gestvente-web .

FROM node:24-alpine AS construction
RUN corepack enable
WORKDIR /depot
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY app/package.json app/
# Le code partagé se compile à l'installation (script prepare) : ses sources d'abord.
COPY packages/commun packages/commun
RUN pnpm install --frozen-lockfile --filter "@gestvente/app..."
COPY app app
# Même origine que le site : l'API est servie sous /api par Caddy.
ENV EXPO_PUBLIC_API_URL=/api
RUN pnpm --filter @gestvente/commun build \
  && cd app && CI=1 npx expo export --platform web --output-dir dist-web

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=construction /depot/app/dist-web /srv
