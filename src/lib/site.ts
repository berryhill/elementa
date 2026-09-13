export function getSiteConfig(env: Record<string, string | undefined> = process.env) {
  const stage = env.SITE_STAGE || 'preview';
  if (!['preview','public-teaser'].includes(stage)) throw new Error('Invalid SITE_STAGE');
  const indexable = stage === 'public-teaser';
  let origin: string | undefined;
  if (env.SITE_ORIGIN) {
    const invalidOrigin = 'SITE_ORIGIN must be a public HTTPS origin without credentials, path, query or fragment';
    let url: URL;
    try { url = new URL(env.SITE_ORIGIN); } catch { throw new Error(invalidOrigin); }
    const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
    const localHost = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127\./.test(hostname) || hostname === '0.0.0.0';
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || localHost) throw new Error(invalidOrigin);
    // Syntactic validation does not prove domain ownership or release approval.
    origin = url.origin;
  }
  if (indexable && (!origin || env.FESTIVAL_FACTS_APPROVED !== 'true' || env.ANNOUNCEMENT_INSTANT_APPROVED !== 'true')) throw new Error('Public release requires SITE_ORIGIN and approved festival facts/announcement instant');
  // Never promote this unconnected signup prototype as a production subscription service.
  if (indexable) throw new Error('Public release blocked: connect approved signup destination and privacy policy, then replace this gate with integration checks');
  return { origin, indexable, stage };
}
export function serializeJsonLd(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
