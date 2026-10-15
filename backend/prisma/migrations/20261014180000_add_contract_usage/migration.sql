-- Tempo MEDIDO por contrato: cada heartbeat soma o intervalo desde o sinal
-- anterior no contrato em que a aba estava. Substitui a estimativa que vinha
-- do intervalo entre eventos do audit_logs.
ALTER TABLE "access_sessions" ADD COLUMN "last_contract_id" UUID;

CREATE TABLE "session_contract_usage" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "session_contract_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_contract_usage_session_id_contract_id_key"
    ON "session_contract_usage"("session_id", "contract_id");
CREATE INDEX "session_contract_usage_contract_id_idx"
    ON "session_contract_usage"("contract_id");

ALTER TABLE "session_contract_usage" ADD CONSTRAINT "session_contract_usage_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "access_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_contract_usage" ADD CONSTRAINT "session_contract_usage_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
