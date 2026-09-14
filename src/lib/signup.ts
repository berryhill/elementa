// Transport/domain logic kept independent of MongoDB for deterministic tests.
export const CONSENT_VERSION = 'elementa-updates-promotions-v2';
export type Subscriber = {
  email: string; locale: 'es' | 'en'; consent: true;
  consentVersion: string; createdAt: Date;
};
export type SignupRepository = (subscriber: Subscriber) => Promise<boolean>;
const MAX_BYTES = 2048;
const response = (status: number) => Response.json(
  status === 200 ? { ok: true } : { ok: false, error: 'Unable to process signup.' },
  { status, headers: { 'Cache-Control': 'no-store' } },
);

export function createSignupHandler(save: SignupRepository, allowedOrigin?: string) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response(405);
    try {
      const expected = allowedOrigin ?? new URL(request.url).origin;
      const configured = new URL(expected);
      if (!['https:', 'http:'].includes(configured.protocol) || configured.origin !== expected) return response(503);
      if (request.headers.get('origin') !== expected) return response(403);
      const site = request.headers.get('sec-fetch-site');
      if (site && site !== 'same-origin') return response(403);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) return response(415);
      const length = request.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return response(413);
      if (!request.body) return response(400);
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) { await reader.cancel(); return response(413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body: unknown;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { return response(400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return response(400);
      const input = body as Record<string, unknown>;
      if (Object.keys(input).sort().join(',') !== 'consent,email,locale' ||
          input.consent !== true || (input.locale !== 'es' && input.locale !== 'en') ||
          typeof input.email !== 'string' || input.email.length > 254) return response(400);
      const email = input.email.trim().toLowerCase();
      // Deliberately conservative ASCII mailbox policy, shared by both locales.
      const [local, domain, extra] = email.split('@');
      if (!local || !domain || extra !== undefined || local.length > 64 ||
          !/^[a-z0-9!#$%&'*+\/=?^_`{|}~.-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
          !domain.includes('.') || domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return response(400);
      const acknowledged = await save({ email, locale: input.locale, consent: true, consentVersion: CONSENT_VERSION, createdAt: new Date() });
      return response(acknowledged ? 200 : 503);
    } catch {
      // Never expose/log driver errors, connection strings or submitted addresses.
      return response(503);
    }
  };
}
