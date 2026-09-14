import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { copy, festival, isLocale } from '@/content/festival';
import { getSiteConfig, serializeJsonLd } from '@/lib/site';
import Countdown from '@/components/Countdown';
import Signup from '@/components/Signup';
import SectionEntrance from '@/components/SectionEntrance';
import { countdownValues } from '@/lib/countdown';
import {localizedMetadata,supportedLocales} from '@/lib/localization';
export const dynamicParams = false;
export function generateStaticParams() { return supportedLocales.map(lang=>({lang})); }
export async function generateMetadata({params}:{params:Promise<{lang:string}>}):Promise<Metadata> {
  const {lang} = await params; if (!isLocale(lang)) notFound();
  const t=copy[lang], {origin,indexable}=getSiteConfig();
  const title=`${festival.officialName} ${festival.editionName} | ${t.location}`;
  return localizedMetadata({lang,title,description:t.description,origin,indexable});
}
export default async function Landing({params}:{params:Promise<{lang:string}>}) {
  const {lang}=await params; if(!isLocale(lang)) notFound();
  const t=copy[lang], {origin,indexable}=getSiteConfig();
  return <>
    <link rel="preload" href="/assets/playa-venao.webp" as="image" />
    <div className="world" aria-hidden="true"><div className="coast scene"><img id="coast" src="/assets/playa-venao.webp" alt="" fetchPriority="high" /></div><div className="tide"/><div className="veil"/><div className="grain"/></div>
    <header><nav className="languages" aria-label={t.language}><a id="es" href="/es" lang="es" hrefLang="es" aria-current={lang==='es'?'page':undefined}>ES</a><span aria-hidden="true">/</span><a id="en" href="/en" lang="en" hrefLang="en" aria-current={lang==='en'?'page':undefined}>EN</a></nav></header>
    <main id="main" tabIndex={-1}><div className="composition">
      <div className="brand"><h1 aria-label={`${festival.officialName} ${festival.editionName}`}><img id="emblem" src="/assets/elementa-emblem.png" width="88" height="86" alt="" aria-hidden="true"/><img id="logo" src="/assets/elementa-wordmark.png" width="1096" height="111" alt="ELEMENTA"/></h1><p className="chapter detail">{festival.editionName}</p></div>
      <p className="essence detail">{t.essence}</p>
      <div className="festival detail"><p id="festival-dates">{t.dates}</p><p className="destination">{t.location}</p></div>
      <div className="release detail"><div className="hairline" aria-hidden="true"><span/><i/><span/></div>
        <Countdown lang={lang} initialValues={countdownValues(festival.announcementAt, Date.now())}/>
        <p id="release-date" className="release-copy"><time dateTime={festival.announcementAt}>{t.releaseDate}</time></p>
        <p className="sr-only" id="release-time">{t.releaseTime}</p><Signup lang={lang}/>
      </div>
    </div></main>
    <SectionEntrance />
    <footer><a id="photo-credit" href={`/${lang}/credits`}>{t.credit}</a></footer>
    {indexable && origin && <script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd({'@context':'https://schema.org','@type':'WebSite','@id':`${origin}/#website`,name:festival.officialName,url:origin,inLanguage:supportedLocales})}}/>}
  </>;
}
