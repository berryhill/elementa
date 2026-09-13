"use client";

import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { copy, festival, type Locale } from '@/content/festival';
import { countdownValues } from '@/lib/countdown';

export default function Countdown({ lang, initialValues }: { lang: Locale; initialValues: string[] | null }) {
  const t = copy[lang];
  // The server supplies the snapshot; hydration starts with exactly that value.
  // No-JS visitors receive real numbers (or the truthful expired state), not dashes.
  const [values, setValues] = useState<string[] | null>(initialValues);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setValues(countdownValues(festival.announcementAt, Date.now()));
    setPaused(media.matches);
    setSlot(document.getElementById('motion-slot'));
    // A new reduced-motion request always stops updates; removing it must not
    // override a visitor's explicit pause.
    const update = () => { if (media.matches) setPaused(true); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('motion-enabled', paused === false);
    document.body.classList.toggle('no-motion', paused === true);
    return () => document.body.classList.remove('motion-enabled', 'no-motion');
  }, [paused]);

  useEffect(() => {
    // Do not read the clock on pause: preserve exactly the displayed value.
    if (paused !== false) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { clearInterval(timer); timer = undefined; };
    const tick = () => {
      const next = countdownValues(festival.announcementAt, Date.now());
      setValues(next);
      if (next === null) stop();
      return next;
    };
    const sync = () => {
      stop();
      if (!document.hidden && tick() !== null) timer = setInterval(tick, 1000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { stop(); document.removeEventListener('visibilitychange', sync); };
  }, [paused]);

  return <>
    <h2 id="countdown-label">{values ? t.countdown : t.releaseHeading}</h2>
    {values ? <div id="countdown" role="timer" aria-live="off" aria-labelledby="countdown-label" aria-describedby="release-time">
      {values.map((value, i) => <Fragment key={t.units[i]}>
        {i > 0 && <b aria-hidden="true">:</b>}
        <div><span className="digit">{value}</span><span className="unit">{t.units[i]}</span></div>
      </Fragment>)}
    </div> : <p id="release-state" role="status">{t.pending}</p>}
    {slot && paused !== null && createPortal(
      <button type="button" id="motion" aria-label={paused ? `${t.resume}: ${t.resumeLabel}` : t.pauseLabel} onClick={() => setPaused(p => !p)}>
        <span className="motion-icon" aria-hidden="true">{paused ? '▷' : 'Ⅱ'}</span>
        <span>{paused ? t.resume : t.pause}</span>
      </button>, slot)}
  </>;
}
