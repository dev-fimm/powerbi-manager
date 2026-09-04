/**
 * ============================================================
 * VALIDACAO DE URL DO POWER BI  (regra de negocio 4)
 * ============================================================
 * Somente URLs publicas de "publish to web" / "report embed" sao aceitas:
 *   - https://app.powerbi.com/view?r=...
 *   - https://app.powerbi.com/reportEmbed?reportId=...
 *
 * A validacao e feita com o parser de URL (e nao com um simples startsWith
 * em string), para impedir bypass do tipo:
 *   https://app.powerbi.com.evil.com/view
 *   https://evil.com/?x=https://app.powerbi.com/view
 * O protocolo tem que ser https e o host tem que ser exatamente app.powerbi.com.
 */

const ALLOWED_HOST = 'app.powerbi.com';
const ALLOWED_PATHS = ['/view', '/reportembed'];

export const POWER_BI_URL_ERROR =
  'URL invalida. A URL deve comecar com https://app.powerbi.com/view ou https://app.powerbi.com/reportEmbed';

export function isValidPowerBiUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string') return false;

  const value = rawUrl.trim();
  if (!value) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // Protocolo e host precisam bater exatamente.
  if (url.protocol !== 'https:') return false;
  if (url.hostname.toLowerCase() !== ALLOWED_HOST) return false;

  // O caminho precisa ser /view ou /reportEmbed (case-insensitive),
  // aceitando barra final opcional. Query string e livre (?r=..., ?reportId=...).
  const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return ALLOWED_PATHS.includes(path);
}

/** Normaliza a URL removendo espacos nas pontas. */
export function normalizePowerBiUrl(rawUrl: string): string {
  return rawUrl.trim();
}
