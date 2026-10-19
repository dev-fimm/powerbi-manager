-- Protecao contra forca bruta no login: contador de tentativas por conta e
-- por IP, com janela de tempo e bloqueio temporario.
CREATE TYPE "ThrottleScope" AS ENUM ('ACCOUNT', 'IP');

CREATE TABLE "login_throttle" (
    "id" UUID NOT NULL,
    "scope" "ThrottleScope" NOT NULL,
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_throttle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "login_throttle_scope_key_key" ON "login_throttle"("scope", "key");
CREATE INDEX "login_throttle_updated_at_idx" ON "login_throttle"("updated_at");
