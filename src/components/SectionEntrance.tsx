'use client';

import { useEffect } from 'react';

// Enhancement only: all content is server-rendered and fully visible by default.
export default function SectionEntrance() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches || document.body.classList.contains('no-motion')) return;
    const animations: Animation[] = [];
    const cancel = () => animations.forEach(animation => animation.cancel());
    try {
      for (const [selector, delay] of [['.brand', 0], ['.essence', 0], ['.festival', 120], ['.release', 240]] as const) {
        const element = document.querySelector<HTMLElement>(`#main .composition > ${selector}`);
        if (!element?.animate) continue;
        animations.push(element.animate([
          { opacity: 0.65, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 520, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards', iterations: 1 }));
      }
    } catch {
      cancel(); // Failed/unsupported motion leaves the unchanged static page.
    }
    const onPreference = () => { if (reduced.matches) cancel(); };
    reduced.addEventListener('change', onPreference);
    const observer = new MutationObserver(() => {
      if (document.body.classList.contains('no-motion')) cancel();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => { cancel(); observer.disconnect(); reduced.removeEventListener('change', onPreference); };
  }, []);
  return null;
}
