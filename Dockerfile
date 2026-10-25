FROM node:24-bookworm-slim
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true CHROME_PATH=/usr/bin/chromium DATA_DIR=/var/data/whatsapp
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation tini gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY scripts/patch-whatsapp.cjs ./scripts/patch-whatsapp.cjs
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY admins.txt permisos.txt ./
COPY test ./test
RUN npm run check && npm test
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 /app/docker-entrypoint.sh
EXPOSE 10000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "src/main.js"]

