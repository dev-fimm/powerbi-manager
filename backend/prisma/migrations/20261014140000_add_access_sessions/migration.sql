-- Sessao de uso medida por heartbeat. Substitui a dependencia do LOGOUT
-- para calcular tempo de permanencia (ver comentario no schema.prisma).
CREATE TABLE "access_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "access_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "access_sessions_user_id_idx" ON "access_sessions"("user_id");
CREATE INDEX "access_sessions_user_id_last_seen_at_idx" ON "access_sessions"("user_id", "last_seen_at");
CREATE INDEX "access_sessions_started_at_idx" ON "access_sessions"("started_at");

ALTER TABLE "access_sessions" ADD CONSTRAINT "access_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
