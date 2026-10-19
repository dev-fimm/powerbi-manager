-- Backoff exponencial no bloqueio de login: a duracao cresce a cada novo
-- bloqueio do mesmo alvo. O nivel sobrevive ao fim do bloqueio, senao
-- bastaria esperar para levar sempre a punicao minima.
ALTER TABLE "login_throttle" ADD COLUMN "block_level" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "login_throttle" ADD COLUMN "requires_manual_unlock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "login_throttle" ADD COLUMN "last_failure_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
