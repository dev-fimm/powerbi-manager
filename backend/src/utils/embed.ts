import jwt from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * ============================================================
 * TOKEN DE EMBED
 * ============================================================
 * Um <iframe> carregado pelo navegador NAO envia o header Authorization,
 * entao a rota publica de embed nao pode usar o JWT de sessao. Em vez disso,
 * o front pede um "token de embed" curto (assinado, com validade), especifico
 * de um painel, e o coloca na query da URL do iframe.
 *
 * O token so e emitido pela API depois de validar que a conta tem acesso
 * aquele painel. A rota de embed valida o token e redireciona para a URL real
 * do Power BI - que nunca e enviada ao cliente no JSON da API.
 */

interface EmbedPayload {
  /** id do iframe autorizado. */
  iid: string;
  purpose: 'embed';
}

const EMBED_TTL = '1h';

export function signEmbedToken(iframeId: string): string {
  return jwt.sign({ iid: iframeId, purpose: 'embed' } satisfies EmbedPayload, env.jwtSecret, {
    expiresIn: EMBED_TTL,
  });
}

export function verifyEmbedToken(token: string): EmbedPayload {
  const payload = jwt.verify(token, env.jwtSecret) as EmbedPayload;
  if (payload.purpose !== 'embed' || !payload.iid) {
    throw new Error('Token de embed invalido.');
  }
  return payload;
}
