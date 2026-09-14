'use client';

import { useEffect } from 'react';

// Enhancement only: never animate the already-visible server-rendered content.
export default function SectionEntrance() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let attempted = false;
    let animation: Animation | undefined;
    const cancel = () => { animation?.cancel(); };
    const sync = () => {
      if (reduced.matches || document.body.classList.contains('no-motion')) {
        attempted = true; // A suppressed/cancelled arrival must not replay on resume.
        cancel();
        return;
      }
      // Countdown owns motion readiness; its initial hydration need not run first.
      if (attempted || !document.body.classList.contains('motion-enabled')) return;
      attempted = true;
      const tide = document.querySelector<HTMLElement>('.world .tide');
      try {
        // Only opacity: leave the existing CSS tide transform loop untouched.
        animation = tide?.animate?.([
          { opacity: 0.3, offset: 0 },
          { opacity: 0.42, offset: 0.4 },
          { opacity: 0.3, offset: 1 },
        ], { duration: 1100, easing: 'cubic-bezier(.2,.7,.2,1)', iterations: 1 });
      } catch {
        cancel(); // Unsupported motion leaves the unchanged static background.
      }
    };
    reduced.addEventListener('change', sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    sync();
    return () => { cancel(); observer.disconnect(); reduced.removeEventListener('change', sync); };
  }, []);
  return null;
}
