import { AuditAction } from './audit';

/**
 * ============================================================
 * AGREGACOES DA TELA DE MONITORAMENTO
 * ============================================================
 * Agrupamentos por periodo a partir das linhas de audit_logs.
 *
 * TEMPO nao sai daqui. Tanto a duracao da sessao quanto o tempo por contrato
 * sao MEDIDOS por heartbeat (access_sessions e session_contract_usage, ver
 * utils/accessSession.ts). Antes o tempo por contrato era estimado pelo
 * intervalo entre eventos registrados - uma heuristica que contava a mais
 * quando a pessoa se ausentava com a tela aberta, e a menos quando ela lia
 * por muito tempo sem gerar evento nenhum.
 *
 * As agregacoes por dia/semana rodam aqui, em JavaScript, e nao em SQL. O
 * motivo e fuso: `created_at` e UTC, e agrupar por dia em UTC jogaria um
 * acesso das 21h (00h UTC do dia seguinte) para o dia errado. Em JS o
 * agrupamento usa o fuso do servidor, que e o fuso de quem le o relatorio.
 */

/** Linha de audit_logs no formato minimo que as agregacoes precisam. */
export interface AuditRow {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------- periodos

/** Chave de dia no fuso do servidor: "yyyy-mm-dd". */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Chave de semana: a data da SEGUNDA-feira daquela semana, "yyyy-mm-dd".
 * Semana comecando na segunda e a convencao de calendario de trabalho no
 * Brasil - agrupar a partir de domingo partiria a semana util em duas.
 */
export function weekKey(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0 = domingo. Domingo recua 6 dias; os demais, (dia - 1).
  const back = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - back);
  return dayKey(d);
}

export type Granularity = 'day' | 'week';

export function periodKey(date: Date, granularity: Granularity): string {
  return granularity === 'week' ? weekKey(date) : dayKey(date);
}

/**
 * Lista todas as chaves de periodo entre from e to, inclusive - inclusive as
 * vazias. Sem isso um grafico de linha "pula" os dias sem acesso e sugere
 * continuidade onde houve zero.
 */
export function periodRange(from: Date, to: Date, granularity: Granularity): string[] {
  const keys: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  if (granularity === 'week') {
    // Alinha o cursor na segunda-feira da semana inicial.
    const back = cursor.getDay() === 0 ? 6 : cursor.getDay() - 1;
    cursor.setDate(cursor.getDate() - back);
  }

  while (cursor <= end) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + (granularity === 'week' ? 7 : 1));
  }
  return keys;
}

// --------------------------------------------------------------- utilitarios

/** Soma por chave, devolvendo um Map ja pronto para virar array ordenado. */
export function tally<T>(items: T[], keyOf: (item: T) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Extrai o contractId de um pathname de page view "/paineis/<uuid>". */
const VIEWER_PATH = /^\/paineis\/([0-9a-fA-F-]{36})$/;

export function contractIdFromPath(path: string | null): string | null {
  if (!path) return null;
  const match = VIEWER_PATH.exec(path);
  return match ? match[1]!.toLowerCase() : null;
}
