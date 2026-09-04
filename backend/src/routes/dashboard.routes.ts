import { ContractStatus, Role } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middlewares/auth';
import {
  getAccessibleContractIds,
  getGrantedIframeIds,
  hasIframeLevelAccess,
  isAdmin,
} from '../middlewares/rbac';
import { asyncHandler } from '../utils/async';

export const dashboardRoutes = Router();

dashboardRoutes.use(authenticate);

/**
 * GET /api/dashboard/summary
 * Contadores da pagina inicial. Sempre respeitam o escopo do usuario:
 * GESTOR/VISUALIZADOR so contam os contratos associados a eles.
 * O total de usuarios so e retornado para ADMIN.
 */
dashboardRoutes.get(
  '/summary',
  asyncHandler(async (req, res) => {
    // VISUALIZADOR: os numeros refletem os dashboards concedidos individualmente
    // (mesma visao do viewer), e nao os contratos associados.
    if (hasIframeLevelAccess(req.user!)) {
      const grantedIds = await getGrantedIframeIds(req.user!);

      const grantedIframes = await prisma.iframe.findMany({
        where: { id: { in: grantedIds } },
        select: { isActive: true, contract: { select: { id: true, status: true } } },
      });

      const activeIframes = grantedIframes.filter((i) => i.isActive);
      // Contratos distintos (nao encerrados) que possuem paineis concedidos.
      const contractsById = new Map<string, ContractStatus>();
      for (const i of activeIframes) {
        if (i.contract.status !== ContractStatus.ENCERRADO) {
          contractsById.set(i.contract.id, i.contract.status);
        }
      }
      const statuses = [...contractsById.values()];

      res.json({
        contracts: {
          total: statuses.length,
          ativos: statuses.filter((s) => s === ContractStatus.ATIVO).length,
          suspensos: statuses.filter((s) => s === ContractStatus.SUSPENSO).length,
          encerrados: 0,
        },
        iframes: { total: activeIframes.length, ativos: activeIframes.length },
        users: null,
        role: req.user!.role as Role,
      });
      return;
    }

    const accessibleIds = await getAccessibleContractIds(req.user!);
    const contractScope = accessibleIds ? { id: { in: accessibleIds } } : {};
    const iframeScope = accessibleIds ? { contractId: { in: accessibleIds } } : {};

    const [
      totalContracts,
      activeContracts,
      suspendedContracts,
      closedContracts,
      totalIframes,
      activeIframes,
      totalUsers,
    ] = await Promise.all([
      prisma.contract.count({ where: contractScope }),
      prisma.contract.count({ where: { ...contractScope, status: ContractStatus.ATIVO } }),
      prisma.contract.count({ where: { ...contractScope, status: ContractStatus.SUSPENSO } }),
      prisma.contract.count({ where: { ...contractScope, status: ContractStatus.ENCERRADO } }),
      prisma.iframe.count({ where: iframeScope }),
      prisma.iframe.count({ where: { ...iframeScope, isActive: true } }),
      isAdmin(req.user) ? prisma.user.count() : Promise.resolve(null),
    ]);

    const activeUsers = isAdmin(req.user)
      ? await prisma.user.count({ where: { isActive: true } })
      : null;

    res.json({
      contracts: {
        total: totalContracts,
        ativos: activeContracts,
        suspensos: suspendedContracts,
        encerrados: closedContracts,
      },
      iframes: { total: totalIframes, ativos: activeIframes },
      // null para nao-ADMIN: o card de usuarios nao e exibido nesses perfis.
      users: totalUsers === null ? null : { total: totalUsers, ativos: activeUsers ?? 0 },
      role: req.user!.role as Role,
    });
  }),
);
