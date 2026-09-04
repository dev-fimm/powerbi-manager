/**
 * ============================================================
 * SEED INICIAL
 * ============================================================
 * Cria:
 *   - 1 usuario ADMIN  (admin@sistema.com / admin123)
 *   - 1 usuario GESTOR (gestor@sistema.com / gestor123)
 *   - 1 usuario VISUALIZADOR (viewer@sistema.com / viewer123)
 *   - 2 contratos de exemplo
 *   - 3 iframes de exemplo com URLs publicas do Power BI
 *
 * O seed e idempotente: rodar de novo nao duplica registros.
 * Execute com:  npm run seed
 */
import { ContractStatus, PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env';
import { checkPasswordPolicy } from '../src/utils/password';
import { defaultScreensForRole } from '../src/utils/screens';

const prisma = new PrismaClient();

/**
 * As senhas do seed sao intencionalmente simples (ambiente de demonstracao) e
 * NAO passam pela politica de senha, que so incide sobre senhas definidas pela
 * API. Como essas credenciais estao publicadas no repositorio, o seed avisa
 * de forma visivel quando a senha do admin nao atende a politica - para que
 * ninguem suba um ambiente real com "admin123".
 */
function warnAboutWeakSeedPassword(): void {
  const issues = checkPasswordPolicy(env.seed.adminPassword, {
    email: env.seed.adminEmail,
    name: env.seed.adminName,
  });
  if (issues.length === 0) return;

  console.warn('');
  console.warn('  ****************************************************************');
  console.warn('  *  ATENCAO: a senha do administrador do seed e fraca.          *');
  console.warn('  *  Ela nao atende a politica de senha da aplicacao:            *');
  for (const issue of issues) {
    console.warn(`  *   - ${issue.message.padEnd(56)}*`);
  }
  console.warn('  *                                                              *');
  console.warn('  *  Em qualquer ambiente que nao seja local, defina             *');
  console.warn('  *  SEED_ADMIN_PASSWORD no .env ANTES de rodar o seed, ou       *');
  console.warn('  *  troque a senha no primeiro acesso (menu > Alterar senha).   *');
  console.warn('  ****************************************************************');
  console.warn('');
}

async function main() {
  console.log('> Iniciando seed...');

  warnAboutWeakSeedPassword();

  const saltRounds = env.bcryptSaltRounds;

  // ---------------------------------------------------------------- usuarios
  const admin = await prisma.user.upsert({
    where: { email: env.seed.adminEmail },
    update: {},
    create: {
      name: env.seed.adminName,
      email: env.seed.adminEmail,
      passwordHash: await bcrypt.hash(env.seed.adminPassword, saltRounds),
      role: Role.ADMIN,
      isActive: true,
      allowedScreens: defaultScreensForRole(Role.ADMIN),
    },
  });
  console.log(`  - ADMIN: ${admin.email} / ${env.seed.adminPassword}`);

  const gestor = await prisma.user.upsert({
    where: { email: 'gestor@sistema.com' },
    update: {},
    create: {
      name: 'Gestor de Contratos',
      email: 'gestor@sistema.com',
      passwordHash: await bcrypt.hash('gestor123', saltRounds),
      role: Role.GESTOR,
      isActive: true,
      allowedScreens: defaultScreensForRole(Role.GESTOR),
    },
  });
  console.log('  - GESTOR: gestor@sistema.com / gestor123');

  const visualizador = await prisma.user.upsert({
    where: { email: 'viewer@sistema.com' },
    update: {},
    create: {
      name: 'Usuario Visualizador',
      email: 'viewer@sistema.com',
      passwordHash: await bcrypt.hash('viewer123', saltRounds),
      role: Role.VISUALIZADOR,
      isActive: true,
      allowedScreens: defaultScreensForRole(Role.VISUALIZADOR),
    },
  });
  console.log('  - VISUALIZADOR: viewer@sistema.com / viewer123');

  // ---------------------------------------------------------------- contratos
  const contratoA =
    (await prisma.contract.findFirst({ where: { name: 'Contrato de Saneamento 2026' } })) ??
    (await prisma.contract.create({
      data: {
        name: 'Contrato de Saneamento 2026',
        clientName: 'Companhia Estadual de Saneamento',
        description:
          'Contrato de leitura, entrega de faturas e servicos de campo. Painel operacional e indicadores de produtividade.',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: ContractStatus.ATIVO,
      },
    }));

  const contratoB =
    (await prisma.contract.findFirst({ where: { name: 'Contrato de Distribuicao Regional' } })) ??
    (await prisma.contract.create({
      data: {
        name: 'Contrato de Distribuicao Regional',
        clientName: 'Prefeitura Municipal - Regiao Norte',
        description:
          'Distribuicao de correspondencia e servicos logisticos. Acompanhamento de SLA e ocorrencias.',
        startDate: new Date('2026-03-01'),
        endDate: new Date('2027-02-28'),
        status: ContractStatus.ATIVO,
      },
    }));

  console.log(`  - Contratos: "${contratoA.name}", "${contratoB.name}"`);

  // ---------------------------------------------------------------- vinculos
  // GESTOR gerencia os dois contratos; VISUALIZADOR ve apenas o primeiro.
  await prisma.userContract.createMany({
    data: [
      { userId: gestor.id, contractId: contratoA.id },
      { userId: gestor.id, contractId: contratoB.id },
      { userId: visualizador.id, contractId: contratoA.id },
    ],
    skipDuplicates: true,
  });

  // ---------------------------------------------------------------- iframes
  // URLs publicas do Power BI ("Publicar na web") usadas como placeholder.
  // Substitua pelo link real gerado em: Power BI > Arquivo > Inserir relatorio > Publicar na web.
  const iframesSeed = [
    {
      title: 'Painel Operacional - Producao Diaria',
      powerBiUrl:
        'https://app.powerbi.com/view?r=eyJrIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxIiwidCI6ImRlbW8ifQ%3D%3D',
      description:
        'Acompanhamento diario de leituras realizadas, produtividade por leiturista e cobertura por localidade.',
      contractId: contratoA.id,
      isActive: true,
    },
    {
      title: 'Indicadores de Qualidade e SLA',
      powerBiUrl:
        'https://app.powerbi.com/view?r=eyJrIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAyIiwidCI6ImRlbW8ifQ%3D%3D',
      description:
        'Percentual de entregas no prazo, reincidencia de ocorrencias e penalidades aplicadas no periodo.',
      contractId: contratoA.id,
      isActive: true,
    },
    {
      title: 'Distribuicao - Cobertura por Rota',
      powerBiUrl:
        'https://app.powerbi.com/view?r=eyJrIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAzIiwidCI6ImRlbW8ifQ%3D%3D',
      description:
        'Mapa de cobertura das rotas, volume distribuido por bairro e evolucao mensal do contrato.',
      contractId: contratoB.id,
      isActive: true,
    },
  ];

  for (const data of iframesSeed) {
    const exists = await prisma.iframe.findFirst({
      where: { title: data.title, contractId: data.contractId },
    });
    if (!exists) {
      await prisma.iframe.create({ data });
    }
  }
  console.log(`  - ${iframesSeed.length} iframes de exemplo garantidos.`);

  console.log('> Seed concluido.');
}

main()
  .catch((err) => {
    console.error('Erro no seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
