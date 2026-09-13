import type { Metadata } from 'next';

export const supportedLocales = ['es','en'] as const;
export type SiteLocale = typeof supportedLocales[number];
export const defaultLocale: SiteLocale = 'es';
export const localeHeader = 'x-elementa-locale';
// The root layout cannot read a child segment's params. Proxy supplies the URL's
// locale on the server; never trust a caller-supplied value for this header.
export function localeRequestHeaders(pathname: string, headers: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set(localeHeader, localeFromPath(pathname) || defaultLocale);
  return result;
}
export function localeFromPath(pathname: string): SiteLocale | null {
  const segment=pathname.split(/[?#]/,1)[0].split('/')[1];
  return segment==='es'||segment==='en'?segment:null;
}
// Only reject shapes claimed by the dynamic locale pages. Metadata endpoints
// remain framework routes; unknown deeper paths already use the root 404 UI.
export function isRejectedLocalePage(pathname: string): boolean {
  const path=pathname.replace(/\/$/,'');
  if(path==='/robots.txt'||path==='/sitemap.xml'||path==='/favicon.ico')return false;
  return /^\/[^/]+(?:\/credits)?$/.test(path)&&localeFromPath(path)===null;
}
export function localeAlternates(origin: string) {
 return { es:`${origin}/es`, en:`${origin}/en`, 'x-default':`${origin}/es` };
}
// Only the landing pages are candidates for indexing. An origin configured in
// preview must not advertise noindex translations as public search alternates.
export function localizedMetadata({lang,title,description,origin,indexable,page='landing'}: {
  lang: SiteLocale; title: string; description: string; origin?: string;
  indexable: boolean; page?: 'landing' | 'credits';
}): Metadata {
  const publicLanding = indexable && page === 'landing';
  if (publicLanding && !origin) throw new Error('Indexable metadata requires an approved origin');
  const publicOrigin = publicLanding ? origin : undefined;
  const displayTitle = indexable ? title : `${title} — ${lang === 'es' ? 'Vista previa' : 'Preview'}`;
  return {
    title: displayTitle, description,
    robots: {index: publicLanding, follow: publicLanding},
    ...(publicOrigin ? {
      metadataBase: new URL(publicOrigin),
      alternates: {canonical: `/${lang}`, languages: localeAlternates(publicOrigin)},
    } : {}),
    openGraph: {
      title: displayTitle, description, type: 'website',
      ...(publicOrigin ? {
        url: `${publicOrigin}/${lang}`,
        images: [{url: `${publicOrigin}/assets/elementa-wordmark.png`, alt: 'ELEMENTA'}],
      } : {}),
    },
    twitter: {card: 'summary', title: displayTitle, description,
      ...(publicOrigin ? {images: [`${publicOrigin}/assets/elementa-wordmark.png`]} : {}),
    },
  };
}
// Content language is NOT the visitor's browser-language preference.
// Pure measurement context only: this function never loads GA or sends data.
export function analyticsPageContext(pathname: string) {
 const content_language=localeFromPath(pathname);
 if(!content_language)return null;
 const path=pathname.split(/[?#]/,1)[0].replace(/\/$/,'');
 const page_type=path===`/${content_language}`?'landing':path===`/${content_language}/credits`?'credits':null;
 return page_type?{content_language,page_type}:null;
}
