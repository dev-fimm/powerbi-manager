import { ThrottleScope } from '@prisma/client';
import type { Request } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AuditAction, recordLog } from './audit';
import { TooManyRequestsError } from './errors';

/**
 * ============================================================
 * PROTECAO CONTRA FORCA BRUTA NO LOGIN
 * ============================================================
 * Combina contagem de tentativas (throttling) com bloqueio temporario, em
 * dois eixos independentes:
 *
 * - ACCOUNT: o e-mail informado. Impede martelar a senha de uma conta.
 * - IP: a origem da requisicao. Impede varrer muitas contas do mesmo lugar.
 *
 * Qualquer um dos dois estourando ja barra a tentativa. Os limites sao
 * diferentes de proposito - ver o comentario em config/env.ts.
 *
 * DUAS DECISOES QUE IMPORTAM PARA SEGURANCA:
 *
 * 1. O contador da CONTA e indexado pelo e-mail digitado, exista ele ou nao.
 *    Se so contasse para conta existente, o atacante descobriria quais
 *    e-mails existem observando qual deles chega a ser bloqueado.
 *
 * 2. A verificacao do bloqueio acontece ANTES de conferir a senha, e a
 *    resposta e a mesma para conta bloqueada, senha errada ou e-mail
 *    inexistente em termos de conteudo revelado: nenhuma delas diz se a
 *    conta existe.
 *
 * 3. O bloqueio tem BACKOFF EXPONENCIAL: cada novo bloqueio do mesmo alvo
 *    dura mais que o anterior (1min, 5min, 15min, 1h, 24h por padrao). O
 *    nivel sobrevive ao fim do bloqueio - se zerasse junto, o atacante
 *    levaria sempre a punicao minima, bastando esperar. Ele so volta a zero
 *    num login bem-sucedido ou apos um periodo longo sem nenhuma falha.
 */

interface ThrottleRule {
  scope: ThrottleScope;
  key: string;
  limit: number;
}

/** O que aconteceu quando uma falha estourou o limite de um alvo. */
interface FailureOutcome {
  /** 1 = primeiro bloqueio deste alvo. */
  level: number;
  /** Fim do bloqueio, ou null quando exige liberacao manual. */
  blockedUntil: Date | null;
  manual: boolean;
}

/** Os dois alvos avaliados em cada tentativa. */
function rulesFor(email: string, ip: string | null): ThrottleRule[] {
  const rules: ThrottleRule[] = [
    {
      scope: ThrottleScope.ACCOUNT,
      key: email.trim().toLowerCase(),
      limit: env.loginThrottle.maxAttempts,
    },
  ];

  // Sem IP identificavel nao da para contar por origem; o eixo da conta
  // continua valendo.
  if (ip) {
    rules.push({
      scope: ThrottleScope.IP,
      key: ip,
      limit: env.loginThrottle.maxAttemptsPerIp,
    });
  }

  return rules;
}

/** IP do cliente, respeitando proxies (X-Forwarded-For). */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

/**
 * Duracao do bloqueio de um nivel (1 = primeiro bloqueio).
 * Niveis acima da sequencia repetem o ultimo degrau.
 */
function durationForLevel(level: number): number {
  const steps = env.loginThrottle.blockSteps;
  return steps[Math.min(level, steps.length) - 1]!;
}

/** true quando o nivel caiu no ultimo degrau e a config exige liberacao manual. */
function needsManualUnlock(level: number): boolean {
  return (
    env.loginThrottle.manualUnlockAtLastStep &&
    level >= env.loginThrottle.blockSteps.length
  );
}

/** Texto de duracao legivel: "45 segundo(s)", "5 minuto(s)", "24 hora(s)". */
function humanize(seconds: number): string {
  if (seconds < 60) return `${seconds} segundo(s)`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} minuto(s)`;
  return `${Math.ceil(seconds / 3600)} hora(s)`;
}

/**
 * Mensagem do 429. Nunca diz se a conta existe, qual eixo bloqueou nem em
 * que nivel esta - informar o nivel entregaria ao atacante um retorno sobre
 * o proprio progresso.
 */
function blockedMessage(seconds: number | null): string {
  if (seconds === null) {
    return 'Conta bloqueada por excesso de tentativas. Contate o administrador.';
  }
  return `Muitas tentativas de login. Tente novamente em ${humanize(seconds)}.`;
}

/**
 * Barra a tentativa se a conta OU o IP estiverem bloqueados.
 *
 * Roda ANTES da conferencia de senha: durante o bloqueio, nem a senha certa
 * entra (regra 2).
 */
export async function assertNotBlocked(email: string, ip: string | null): Promise<void> {
  const now = new Date();
  const rules = rulesFor(email, ip);

  const rows = await prisma.loginThrottle.findMany({
    where: {
      OR: rules.map((r) => ({ scope: r.scope, key: r.key })),
      // Bloqueio com prazo em aberto OU bloqueio sem prazo (liberacao manual).
      AND: [{ OR: [{ blockedUntil: { gt: now } }, { requiresManualUnlock: true }] }],
    },
    select: { blockedUntil: true, requiresManualUnlock: true },
  });

  if (rows.length === 0) return;

  // Sem prazo vence qualquer prazo: nao adianta oferecer um tempo de espera.
  if (rows.some((r) => r.requiresManualUnlock)) {
    throw new TooManyRequestsError(blockedMessage(null), null);
  }

  // Se os dois eixos estiverem bloqueados, vale o que termina mais tarde.
  const until = rows.reduce(
    (max, r) => (r.blockedUntil! > max ? r.blockedUntil! : max),
    rows[0]!.blockedUntil!,
  );
  const remaining = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));

  throw new TooManyRequestsError(blockedMessage(remaining), remaining);
}

/**
 * Registra UMA falha em um eixo e devolve ate quando ele ficou bloqueado
 * (ou null, se ainda nao estourou o limite).
 *
 * CONDICAO DE CORRIDA: duas tentativas simultaneas da mesma conta leriam o
 * mesmo contador e gravariam o mesmo valor, perdendo uma falha - e com
 * tentativas paralelas suficientes o limite nunca seria alcancado, que e
 * exatamente o que um atacante faria. O lock consultivo serializa por alvo:
 * alvos diferentes nao esperam uns pelos outros, e ele se solta sozinho no
 * fim da transacao, inclusive se ela falhar.
 */
async function registerFailure(rule: ThrottleRule): Promise<FailureOutcome | null> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - env.loginThrottle.windowSeconds * 1000);
  const levelResetBefore = new Date(
    now.getTime() - env.loginThrottle.levelResetSeconds * 1000,
  );

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${rule.scope}:${rule.key}`}))`;

    const current = await tx.loginThrottle.findUnique({
      where: { scope_key: { scope: rule.scope, key: rule.key } },
    });

    // Janela vencida (ou primeira falha): o contador recomeca do zero. E o
    // que faz "3 erros em 1 minuto" significar isso, e nao "3 erros desde
    // sempre".
    const withinWindow = current !== null && current.windowStartedAt > windowStart;
    const failures = withinWindow ? current.failures + 1 : 1;

    /**
     * O NIVEL tem vida propria, bem mais longa que a janela de contagem: ele
     * so volta a zero depois de levelResetSeconds sem nenhuma falha. Repare
     * que o corte usa a ultima FALHA, e nao o fim do bloqueio - quem errou
     * de novo no dia seguinte continua reincidente.
     */
    const levelExpired =
      current === null || current.lastFailureAt <= levelResetBefore;
    const baseLevel = levelExpired ? 0 : current.blockLevel;

    const reachedLimit = failures >= rule.limit;
    const level = reachedLimit ? baseLevel + 1 : baseLevel;
    const manual = reachedLimit && needsManualUnlock(level);

    const blockedUntil = reachedLimit
      ? manual
        ? null
        : new Date(now.getTime() + durationForLevel(level) * 1000)
      : // Sem estourar o limite, preserva o bloqueio vigente (se houver).
        levelExpired
        ? null
        : (current?.blockedUntil ?? null);

    await tx.loginThrottle.upsert({
      where: { scope_key: { scope: rule.scope, key: rule.key } },
      create: {
        scope: rule.scope,
        key: rule.key,
        failures,
        windowStartedAt: now,
        lastFailureAt: now,
        blockLevel: level,
        blockedUntil,
        requiresManualUnlock: manual,
      },
      update: {
        failures,
        ...(withinWindow ? {} : { windowStartedAt: now }),
        lastFailureAt: now,
        blockLevel: level,
        blockedUntil,
        ...(manual ? { requiresManualUnlock: true } : {}),
      },
    });

    if (!reachedLimit) return null;
    return { level, blockedUntil, manual };
  });
}

/**
 * Contabiliza uma tentativa falha nos dois eixos e registra na auditoria
 * cada bloqueio disparado.
 *
 * O log guarda quem, de onde e quando - nunca a senha digitada, nem sequer
 * seu tamanho.
 */
export async function registerFailedAttempt(
  req: Request,
  email: string,
  ip: string | null,
  /** Conta correspondente, quando o e-mail existe. */
  actor?: { id: string; name: string; email: string } | null,
): Promise<FailureOutcome | null> {
  let strongest: FailureOutcome | null = null;

  for (const rule of rulesFor(email, ip)) {
    const outcome = await registerFailure(rule);
    if (!outcome) continue;

    // Prevalece o bloqueio mais severo entre os eixos: sem prazo vence
    // qualquer prazo, e entre prazos vence o que termina mais tarde.
    if (
      !strongest ||
      outcome.manual ||
      (!strongest.manual &&
        outcome.blockedUntil !== null &&
        strongest.blockedUntil !== null &&
        outcome.blockedUntil > strongest.blockedUntil)
    ) {
      strongest = outcome;
    }

    const alvo =
      rule.scope === ThrottleScope.ACCOUNT ? `conta "${rule.key}"` : `IP ${rule.key}`;
    const prazo = outcome.blockedUntil
      ? `Liberado em ${outcome.blockedUntil.toISOString()}.`
      : 'Exige liberacao manual (redefinicao de senha pelo administrador).';

    await recordLog(req, {
      action: AuditAction.LOGIN_BLOCKED,
      entity: 'LoginThrottle',
      entityId: rule.key,
      ...(actor ? { actor } : { actor: { email } }),
      description:
        `Bloqueio ${outcome.level}o nivel por excesso de tentativas de login: ${alvo}. ` +
        `${rule.limit} falha(s) em ate ${env.loginThrottle.windowSeconds}s. ${prazo}`,
    });
  }

  return strongest;
}

/**
 * Erro 429 do bloqueio recem-disparado. Usado quando a propria tentativa
 * atual foi a que estourou o limite: avisar so na tentativa seguinte
 * deixaria a pessoa sem entender por que a senha certa falhou.
 */
export function blockedError(outcome: FailureOutcome): TooManyRequestsError {
  if (!outcome.blockedUntil) {
    return new TooManyRequestsError(blockedMessage(null), null);
  }
  const remaining = Math.max(
    1,
    Math.ceil((outcome.blockedUntil.getTime() - Date.now()) / 1000),
  );
  return new TooManyRequestsError(blockedMessage(remaining), remaining);
}

/**
 * Zera contador E nivel apos um login bem-sucedido.
 *
 * Apagar a linha zera as duas coisas de uma vez. Limpa tambem o eixo do IP:
 * quem acabou de provar que tem credencial valida nao e o varredor que o
 * contador do IP existe para conter.
 */
export async function clearAttempts(email: string, ip: string | null): Promise<void> {
  const rules = rulesFor(email, ip);

  await prisma.loginThrottle.deleteMany({
    where: { OR: rules.map((r) => ({ scope: r.scope, key: r.key })) },
  });
}

/**
 * Libera uma conta: apaga contador, nivel e bloqueio sem prazo.
 *
 * E o caminho de volta do bloqueio que exige liberacao manual - chamado
 * quando a senha da conta e redefinida, pelo administrador ou pelo proprio
 * usuario. Sem isto, o ultimo degrau configurado como manual deixaria a
 * conta presa sem nenhuma saida pela aplicacao.
 */
export async function unlockAccount(email: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({
    where: { scope: ThrottleScope.ACCOUNT, key: email.trim().toLowerCase() },
  });
}
