import { ContractStatus, Prisma, Role } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middlewares/auth';
import {
  assertContractAccess,
  getAccessibleContractIds,
  getGrantedIframeIds,
  hasIframeLevelAccess,
} from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';
import { verifyEmbedToken, signEmbedToken } from '../utils/embed';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../utils/errors';
import { serializeContract, serializeViewerIframe } from '../utils/serialize';
import { uuidParam } from '../validators/schemas';

export const viewerRoutes = Router();

/**
 * GET /api/viewer/iframes/:id/embed?t=<token>
 * Rota PUBLICA (definida antes do authenticate): um <iframe> do navegador nao
 * envia o header Authorization. A autenticacao aqui e feita pelo token de embed
 * na query, emitido pela API apenas para quem tem acesso ao painel.
 *
 * Redireciona para a URL real do Power BI - que nunca trafega no JSON da API.
 */
viewerRoutes.get(
  '/iframes/:id/embed',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const token = typeof req.query.t === 'string' ? req.query.t : '';

    if (!token) throw new UnauthorizedError('Token de visualizacao ausente.');

    let payload;
    try {
      payload = verifyEmbedToken(token);
    } catch {
      throw new UnauthorizedError('Token de visualizacao invalido ou expirado.');
    }

    if (payload.iid !== id) {
      throw new ForbiddenError('Token nao corresponde ao painel solicitado.');
    }

    const iframe = await prisma.iframe.findUnique({ where: { id } });
    if (!iframe || !iframe.isActive) throw new NotFoundError('Painel nao encontrado.');

    // Redireciona para a URL real do Power BI. A URL nao vai no JSON da API nem
    // no src do iframe; ela so aparece no header Location deste redirect
    // (necessario para o painel "Publicar na web" renderizar).
    res.removeHeader('X-Frame-Options');
    res.redirect(302, iframe.powerBiUrl);
  }),
);

viewerRoutes.use(authenticate);

/**
 * GET /api/viewer/contracts
 * Contratos que o usuario logado pode visualizar.
 * Regra 6: contratos ENCERRADOS nao aparecem no viewer.
 */
viewerRoutes.get(
  '/contracts',
  asyncHandler(async (req, res) => {
    // VISUALIZADOR: acesso por dashboard. Mostra apenas contratos (nao encerrados)
    // que tenham ao menos um painel ativo concedido a esta conta.
    if (hasIframeLevelAccess(req.user!)) {
      const grantedIds = await getGrantedIframeIds(req.user!);

      const contracts = await prisma.contract.findMany({
        where: {
          status: { not: ContractStatus.ENCERRADO },
          iframes: { some: { isActive: true, id: { in: grantedIds } } },
        },
        orderBy: { name: 'asc' },
        include: {
          // So conta os paineis ativos concedidos a este usuario.
          _count: {
            select: {
              iframes: { where: { isActive: true, id: { in: grantedIds } } },
              users: true,
            },
          },
        },
      });

      res.json(contracts.map(serializeContract));
      return;
    }

    // ADMIN / GESTOR: acesso por contrato (comportamento original).
    const accessibleIds = await getAccessibleContractIds(req.user!);

    const where: Prisma.ContractWhereInput = {
      ...(accessibleIds ? { id: { in: accessibleIds } } : {}),
      status: { not: ContractStatus.ENCERRADO },
    };

    const contracts = await prisma.contract.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        // Conta apenas os iframes ativos, que sao os que o viewer exibe (regra 5).
        _count: { select: { iframes: { where: { isActive: true } }, users: true } },
      },
    });

    res.json(contracts.map(serializeContract));
  }),
);

/**
 * GET /api/viewer/contracts/:id/iframes
 * Iframes exibiveis do contrato.
 * Regra 5: is_active = false nao aparece.
 * Regra 6: se o contrato estiver ENCERRADO, nada e exibido.
 */
viewerRoutes.get(
  '/contracts/:id/iframes',
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);

    const contract = await prisma.contract.findUnique({ where: { id } });
    if (!contract) throw new NotFoundError('Contrato nao encontrado.');

    if (contract.status === ContractStatus.ENCERRADO) {
      throw new ForbiddenError(
        'Este contrato esta ENCERRADO. Seus relatorios nao estao disponiveis para visualizacao.',
      );
    }

    const iframeWhere: Prisma.IframeWhereInput = { contractId: id, isActive: true };

    if (hasIframeLevelAccess(req.user!)) {
      // VISUALIZADOR: restringe aos dashboards concedidos individualmente.
      const grantedIds = await getGrantedIframeIds(req.user!);
      iframeWhere.id = { in: grantedIds };
    } else {
      // ADMIN / GESTOR: exige acesso ao contrato (ADMIN sempre passa).
      await assertContractAccess(req.user!, id);
    }

    const iframes = await prisma.iframe.findMany({
      where: iframeWhere,
      orderBy: { createdAt: 'asc' },
    });

    // VISUALIZADOR sem nenhum painel concedido neste contrato nao tem acesso.
    if (req.user!.role === Role.VISUALIZADOR && iframes.length === 0) {
      throw new ForbiddenError('Voce nao tem acesso a nenhum painel deste contrato.');
    }

    res.json({
      contract: serializeContract(contract),
      // Sem power_bi_url: cada painel recebe um token de embed de curta duracao.
      iframes: iframes.map((i) => serializeViewerIframe(i, signEmbedToken(i.id))),
    });
  }),
);
