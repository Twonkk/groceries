FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4827
ENV DATA_DIR=/app/data
ENV APP_UID=99
ENV APP_GID=100

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY docker-entrypoint.sh ./

RUN apk add --no-cache su-exec \
  && mkdir -p /app/data \
  && chmod +x /app/docker-entrypoint.sh

EXPOSE 4827
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4827) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
