'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { analyticsPage, createPageTracker, initializeAnalytics, measurementId, type Gtag } from '@/lib/analytics';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

export default function GoogleAnalytics() {
  const pathname = usePathname();
  const tracker = useRef<ReturnType<typeof createPageTracker> | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!pathname) return;
    if (!tracker.current) {
      if (!analyticsPage(pathname, window.location.origin)) return;
      window.dataLayer = window.dataLayer || [];
      // gtag requires Arguments objects, matching Google's supplied snippet.
      window.gtag = window.gtag || function () { window.dataLayer!.push(arguments); };
      initializeAnalytics(window.gtag, pathname, window.location.origin);
      tracker.current = createPageTracker(window.gtag, window.location.origin);
      setInitialized(true);
    }
    tracker.current(pathname);
  }, [pathname]);

  // Queue privacy-safe config and exactly one page view before the async library
  // can execute. Mount once in the root layout, not once per locale/page.
  return initialized ? <Script
    id="elementa-google-analytics"
    async
    src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
    strategy="afterInteractive"
    referrerPolicy="no-referrer"
  /> : null;
}
