import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import {headers} from 'next/headers';
import {isLocale} from '@/content/festival';
import {defaultLocale,localeHeader} from '@/lib/localization';
import {getSiteConfig} from '@/lib/site';
import './globals.css';
// Valid pages override this title. Unmatched routes and rejected locales inherit
// a useful server-rendered error title without client-side document mutations.
export const metadata: Metadata = {title:'ELEMENTA | 404 — Página no encontrada · Page not found',robots:{index:false,follow:false},icons:{icon:'/assets/elementa-emblem.png'}};
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#080e0e'};
export default async function RootLayout({children}:{children:ReactNode}) {
 getSiteConfig(); // Fail closed on every document, including credits and errors.
 // Request-time SSR is intentional: no client effect or child-param assumption.
 const candidate=(await headers()).get(localeHeader);
 const lang=candidate&&isLocale(candidate)?candidate:defaultLocale;
 return <html lang={lang}><body data-phase="rest">{children}</body></html>;
}
