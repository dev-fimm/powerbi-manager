-- Perfil DESENVOLVEDOR: mesmos acessos do ADMIN, exceto alterar/remover
-- contas ADMIN (ver backend/src/middlewares/rbac.ts).
--
-- ALTER TYPE ... ADD VALUE roda dentro de transacao a partir do PostgreSQL 12
-- desde que o novo valor nao seja usado na mesma transacao - e este migration
-- apenas o adiciona. O projeto exige PostgreSQL 14+.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DESENVOLVEDOR';
