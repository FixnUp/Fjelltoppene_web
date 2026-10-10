# Fjelltoppene.no: Node-server med innlogget admin for tekst og bilder.
# Bygges med repoets rot som kontekst (Railway gjør det automatisk).
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev

COPY server/ server/
COPY admin/ admin/
COPY index.html privacy.html feedback.html logo.html send-inn.html site/
COPY assets/ site/assets/

ENV SITE_DIR=/app/site
EXPOSE 8080

# Kjører som root fordi Railway-volumer monteres med root som eier.
CMD ["node", "server/server.js"]
