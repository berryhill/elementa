FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY next.config.ts next-env.d.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/berryhill/elementa"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
