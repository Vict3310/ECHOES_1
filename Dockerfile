# API image for the ECHOES server.
#
# The web client is built and served separately (see client/vercel.json): this
# image contains the Express API, the curated dataset it reads at runtime, and
# the generated Prisma client.
#
#   docker build -t echoes-api .
#   docker run --rm -p 8787:8787 --env-file .env echoes-api
#
# Configuration is runtime-only: nothing from .env is baked into the image.

# --- Build -------------------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app

# Manifests first so the dependency layer is cached independently of the source.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY server server
COPY data data

RUN npx prisma generate --schema server/prisma/schema.prisma \
 && npm --workspace server run build

# --- Runtime -----------------------------------------------------------------
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev && npm cache clean --force

# The generated Prisma client is produced at build time, not by a production install.
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/server/dist server/dist

# Schema and SQL ship with the image so migrations can be run against a target
# database from a one-off container.
COPY server/prisma server/prisma

# The dataset is read from disk at runtime (data/dataset.ts walks up to find it),
# so it must be present in the image, not only in the build stage.
COPY data data

# Run as the non-root user that the node images provide.
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
