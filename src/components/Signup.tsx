"use client";

import { useEffect, useRef, useState } from 'react';
import { copy, type Locale } from '@/content/festival';

export default function Signup({ lang }: { lang: Locale }) {
  const t = copy[lang];
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    if (succeeded) dialog.current?.querySelector<HTMLElement>('#email-title')?.focus();
  }, [succeeded]);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    setReady(typeof dialog.current?.showModal === 'function');
    return () => { active.current?.abort(); active.current = null; };
  }, []);

  function cancelRequest() {
    active.current?.abort();
    active.current = null;
    setPending(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || !event.currentTarget.reportValidity()) return;
    const target = event.currentTarget;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setMessage('');
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ email: (target.elements.namedItem('email') as HTMLInputElement).value,
          locale: lang, consent: (target.elements.namedItem('consent') as HTMLInputElement).checked }),
      });
      if (!response.ok || (await response.json()).ok !== true) throw new Error('Signup unavailable');
      if (active.current !== controller || !dialog.current?.open) return;
      setSucceeded(true);
      target.reset();
    } catch {
      if (active.current === controller && dialog.current?.open) setMessage(t.error);
    } finally {
      clearTimeout(timer);
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  }

  function open() {
    if (!dialog.current || dialog.current.open) return;
    setMessage('');
    dialog.current.showModal();
    dialog.current.querySelector<HTMLInputElement>('#email-address')?.focus();
  }

  function close() { cancelRequest(); dialog.current?.close(); }

  return <>
    <div id="email-cta">
      <button ref={button} disabled={!ready} type="button" id="email-open" aria-haspopup="dialog" aria-controls="email-dialog" onClick={open}>{t.cta}</button>
      <noscript><p>{t.noScript}</p></noscript>
    </div>
    <dialog ref={dialog} id="email-dialog" aria-labelledby="email-title" aria-describedby={succeeded ? undefined : "email-intro email-privacy"}
      onClose={() => { cancelRequest(); form.current?.reset(); setMessage(''); setSucceeded(false); button.current?.focus(); }}
      onCancel={e => { e.preventDefault(); close(); }}
      onClick={e => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      }}>
      <button className="email-close" type="button" aria-label={t.close} onClick={close}>×</button>
      {succeeded ? <div className="email-success">
        <h2 id="email-title" tabIndex={-1}>{t.result}</h2>
        <p>{t.thanks}</p>
        <button type="button" className="email-submit" onClick={close}>{t.close}</button>
      </div> : <>
      <h2 id="email-title">{t.signupTitle}</h2>
      <p id="email-intro">{t.intro}</p>
      <form ref={form} autoComplete="off" onSubmit={submit} aria-busy={pending}>
        <label className="email-label" htmlFor="email-address">{t.email}</label>
        <input id="email-address" name="email" disabled={pending} type="email" required maxLength={254} inputMode="email" autoComplete="off" aria-describedby="email-privacy" />
        <label className="email-consent"><input name="consent" disabled={pending} type="checkbox" required /><span>{t.consent}</span></label>
        <p id="email-privacy" className="email-privacy">{t.privacy}</p>
        <button type="submit" disabled={pending} className="email-submit">{pending ? t.sending : t.submit}</button>
        <p role="status" aria-live="polite">{message}</p>
      </form>
      </>}
    </dialog>
  </>;
}
