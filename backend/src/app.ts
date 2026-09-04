import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProduction } from './config/env';
import { errorHandler, notFoundHandler } from './middlewares/error';
import { routes } from './routes';

export function createApp() {
  const app = express();

  // helmet com CSP desligada: o front renderiza iframes de app.powerbi.com
  // e a API nao serve HTML, entao a CSP padrao so atrapalharia.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  const origins =
    env.corsOrigin === '*'
      ? true
      : env.corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);

  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(isProduction ? 'combined' : 'dev'));

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
