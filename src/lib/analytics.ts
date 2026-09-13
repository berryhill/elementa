import { analyticsPageContext } from './localization';

export const measurementId = 'G-D6NRX54EQP';
export type Gtag = (...args: unknown[]) => void;

// Reconstruct from the allowlisted locale/page type, never an arbitrary URL,
// query, fragment, document title, referrer, or form value.
export function analyticsPage(pathname: string, origin: string) {
  const context = analyticsPageContext(pathname);
  if (!context) return null;
  const page_path = `/${context.content_language}${context.page_type === 'credits' ? '/credits' : ''}`;
  return {
    ...context,
    page_path,
    page_location: `${new URL(origin).origin}${page_path}`,
    page_referrer: '',
    page_title: `ELEMENTA | ${context.page_type} | ${context.content_language}`,
  };
}

export function createPageTracker(gtag: Gtag, origin: string) {
  let previousPath: string | undefined;
  return (pathname: string) => {
    const page = analyticsPage(pathname, origin);
    if (!page) { previousPath = undefined; return; }
    if (page.page_path === previousPath) return;
    previousPath = page.page_path;
    // Global sanitized context also applies to subsequent automatic lifecycle events.
    gtag('set', page);
    gtag('event', 'page_view', { ...page, send_to: measurementId });
  };
}

export function initializeAnalytics(gtag: Gtag, pathname: string, origin: string) {
  const page = analyticsPage(pathname, origin);
  if (!page) return;
  gtag('js', new Date());
  gtag('set', page);
  gtag('config', measurementId, {
    ...page,
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
}
