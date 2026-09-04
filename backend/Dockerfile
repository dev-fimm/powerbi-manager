# ============================================================
# Backend - Node.js + Express + Prisma
# Build multi-stage: compila em TS e roda apenas o dist + deps de producao.
# ============================================================

FROM node:22-alpine AS builder

WORKDIR /app

# openssl e necessario para os binarios de query do Prisma no Alpine.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3333

# Aplica as migracoes pendentes antes de subir a API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
