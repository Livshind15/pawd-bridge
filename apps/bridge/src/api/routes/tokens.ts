import { FastifyInstance } from 'fastify';
import * as tokenStore from '../../store/entities/tokens.js';

function computeWindow(w: tokenStore.UsageWindow) {
  const percent = w.limit > 0 ? w.used / w.limit : 0;
  const remaining = Math.max(0, w.limit - w.used);
  const resetsInMs = Math.max(0, new Date(w.resetsAt).getTime() - Date.now());
  return { used: w.used, limit: w.limit, percent, remaining, resetsAt: w.resetsAt, resetsInMs };
}

export function tokenRoutes(fastify: FastifyInstance): void {
  // GET /api/tokens
  fastify.get('/api/tokens', async () => {
    const tokens = tokenStore.getTokenData();
    return { tokens };
  });

  // GET /api/tokens/usage
  fastify.get('/api/tokens/usage', async () => {
    const tokens = tokenStore.getTokenData();
    return {
      accountBalance: tokens.accountBalance,
      monthlyUsage: tokens.monthlyUsage,
      baseOverhead: tokens.baseOverhead,
      sessionUsage: computeWindow(tokens.sessionUsage),
      weeklyUsage: computeWindow(tokens.weeklyUsage),
    };
  });

  // PUT /api/tokens
  fastify.put<{ Body: Partial<tokenStore.TokenData> }>('/api/tokens', async (request) => {
    const body = request.body as Partial<tokenStore.TokenData>;
    const tokens = tokenStore.saveTokenData(body);
    return { tokens };
  });
}
