/**
 * ============================================================
 * PARAMETROS VISUAIS DOS GRAFICOS
 * ============================================================
 * Paleta categorica ancorada no azul da marca (brand-600). Os quatro tons
 * foram validados para daltonismo: a pior separacao entre vizinhos fica em
 * dE 13.8 (protanopia) e 28.8 na visao normal - acima do piso de 8. Nao troque
 * um tom "no olho": a validacao e computavel e um tom aparentemente distinto
 * pode colapsar em deuteranopia (rosa x verde, por exemplo, da dE 1.1).
 *
 * A identidade nunca depende so da cor: todo grafico com 2+ series leva
 * legenda, e os rotulos de texto usam tokens de tinta (slate), nunca a cor
 * da serie.
 */
export const CATEGORICAL = ['#1d66f0', '#ea580c', '#0d9488', '#9333ea'] as const;

/** Ramp sequencial de uma unica matiz (a da marca), clara -> escura. */
export const SEQUENTIAL = [
  '#eef6ff',
  '#d9ebff',
  '#bcdcff',
  '#8ec6ff',
  '#59a6ff',
  '#3385fb',
  '#1d66f0',
  '#1751dc',
] as const;

/** Tinta recessiva de grade e eixos. */
export const AXIS_COLOR = '#94a3b8';
export const GRID_COLOR = '#e2e8f0';

/**
 * Passo da ramp para um valor entre 0 e max. O zero recebe um cinza bem
 * claro, e nao o primeiro passo da ramp: celula vazia e celula de valor
 * minimo precisam ser distinguiveis.
 */
export function sequentialStep(value: number, max: number): string {
  if (value <= 0) return '#f8fafc';
  if (max <= 0) return SEQUENTIAL[0];
  const ratio = value / max;
  const index = Math.min(SEQUENTIAL.length - 1, Math.ceil(ratio * (SEQUENTIAL.length - 1)));
  return SEQUENTIAL[index]!;
}

// ------------------------------------------------------------- formatadores

/** Duracao legivel a partir de segundos: "2h 15min", "7min", "45s". */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
  if (minutes > 0) return `${minutes}min`;
  return `${seconds}s`;
}

/** Horas com uma decimal, para eixo de grafico. */
export function toHours(totalSeconds: number): number {
  return Math.round((totalSeconds / 3600) * 10) / 10;
}

/**
 * Rotulo curto de um periodo ("2026-10-14" -> "14/10"). Na granularidade
 * semanal a chave e a segunda-feira da semana, e o rotulo diz isso.
 */
export function formatPeriod(key: string, granularity: 'day' | 'week'): string {
  const [, m, d] = key.split('-');
  const short = `${d}/${m}`;
  return granularity === 'week' ? `sem. ${short}` : short;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "há 3 dias", "há 2 meses", "nunca". */
export function formatRelative(iso: string | null): string {
  if (!iso) return 'nunca';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `ha ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'ha 1 mes' : `ha ${months} meses`;
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'] as const;
