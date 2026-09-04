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

# HOME explicito: o usuario "node" precisa de um diretorio gravavel para o
# cache do Prisma quando roda `migrate deploy` na inicializacao.
ENV HOME=/home/node
# Desliga a telemetria do Prisma: um container de producao nao deve abrir
# conexoes de saida que ninguem pediu.
ENV CHECKPOINT_DISABLE=1

RUN apk add --no-cache openssl

COPY package*.json ./
# O CLI do Prisma agora e uma dependencia de producao, entao `migrate deploy`
# roda a partir do node_modules local - sem baixar nada da rede a cada start.
RUN npm ci --omit=dev && npm cache clean --force

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# A imagem node ja traz o usuario nao-privilegiado "node" (uid 1000).
# Rodar como root significa que qualquer execucao remota de codigo na API
# comeca com privilegio total dentro do container.
RUN chown -R node:node /app /home/node
USER node

EXPOSE 3333

# O orquestrador precisa distinguir "processo vivo" de "API respondendo":
# sem healthcheck, um container travado no boot do Prisma segue marcado como
# saudavel e continua recebendo trafego.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --spider --tries=1 http://127.0.0.1:3333/api/health || exit 1

# Aplica as migracoes pendentes antes de subir a API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
