FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/collab/package.json apps/collab/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM dependencies AS source
COPY . .

FROM source AS server
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM source AS web-build
RUN npm run music:scan && npm run build --workspace @modelboard/web

FROM nginx:stable-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=12 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
