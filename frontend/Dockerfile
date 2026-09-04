# ============================================================
# Frontend - React + Vite servido por Nginx
# ============================================================

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# A URL da API e embutida no bundle no momento do build.
# Ex.: docker build --build-arg VITE_API_URL=https://api.suaempresa.com/api .
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build


# ------------------------------------------------------------
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# A imagem oficial do nginx ja roda os workers como usuario "nginx"; apenas o
# processo master fica como root, porque precisa disso para escutar na porta 80.
# Se o ambiente exigir o container inteiro sem privilegio, troque a base por
# nginxinc/nginx-unprivileged:alpine e ajuste a porta de 80 para 8080.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider --tries=1 http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
