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

  useEffect(() => { setReady(typeof dialog.current?.showModal === 'function'); }, []);

  function open() {
    if (!dialog.current || dialog.current.open) return;
    setMessage('');
    dialog.current.showModal();
    dialog.current.querySelector<HTMLInputElement>('#email-address')?.focus();
  }

  function close() { dialog.current?.close(); }

  return <>
    <div id="email-cta">
      <button ref={button} disabled={!ready} type="button" id="email-open" aria-haspopup="dialog" aria-controls="email-dialog" onClick={open}>{t.cta}</button>
      <noscript><p>{t.noScript}</p></noscript>
    </div>
    <dialog ref={dialog} id="email-dialog" aria-labelledby="email-title" aria-describedby="email-intro email-privacy"
      onClose={() => { form.current?.reset(); setMessage(''); button.current?.focus(); }}
      onCancel={e => { e.preventDefault(); close(); }}
      onClick={e => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      }}>
      <button className="email-close" type="button" aria-label={t.close} onClick={close}>×</button>
      <h2 id="email-title">{t.signupTitle}</h2>
      <p id="email-intro">{t.intro}</p>
      {/* Exercise the approved form design without a network/storage destination.
          Submission reports only the preview result, never subscription success. */}
      <form ref={form} autoComplete="off" onSubmit={e => {
        e.preventDefault();
        if (!e.currentTarget.reportValidity()) return;
        setMessage(t.result);
        e.currentTarget.reset();
      }}>
        <label className="email-label" htmlFor="email-address">{t.email}</label>
        <input id="email-address" type="email" required maxLength={254} inputMode="email" autoComplete="off" aria-describedby="email-privacy" />
        <label className="email-consent"><input type="checkbox" required /><span>{t.consent}</span></label>
        <p id="email-privacy" className="email-privacy">{t.privacy}</p>
        <button type="submit" className="email-submit">{t.submit}</button>
        <p role="status" aria-live="polite">{message}</p>
      </form>
    </dialog>
  </>;
}
