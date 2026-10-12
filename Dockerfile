# GROUPDEALS — une seule image : l'API sert aussi le site (apps/web/dist).
# Non construite dans l'environnement de développement d'origine (pas de démon Docker) :
# vérifiez le premier build chez vous.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/apps/api
# Le serveur est un seul fichier ; seuls sharp (code natif) et pg (optionnel) restent à installer.
COPY apps/api/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /src/apps/api/dist ./dist
COPY apps/api/db ./db
COPY --from=build /src/apps/web/dist /app/apps/web/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
ENV UPLOADS_DIR=/data/uploads PORT=4000
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Les migrations sont appliquées au démarrage (verrou consultatif : sans risque avec plusieurs instances).
CMD ["node", "dist/server.js"]
