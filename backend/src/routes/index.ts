import { Router } from 'express';
import { authRoutes } from './auth.routes';
import { contractRoutes } from './contracts.routes';
import { dashboardRoutes } from './dashboard.routes';
import { iframeRoutes } from './iframes.routes';
import { logRoutes } from './logs.routes';
import { userRoutes } from './users.routes';
import { viewerRoutes } from './viewer.routes';

export const routes = Router();

routes.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

routes.use('/auth', authRoutes);
routes.use('/users', userRoutes);
routes.use('/contracts', contractRoutes);
routes.use('/iframes', iframeRoutes);
routes.use('/viewer', viewerRoutes);
routes.use('/dashboard', dashboardRoutes);
routes.use('/logs', logRoutes);
