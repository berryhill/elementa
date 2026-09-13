import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {copy,isLocale} from '@/content/festival';
import {getSiteConfig} from '@/lib/site';
import {localizedMetadata,supportedLocales} from '@/lib/localization';
export const dynamicParams = false;
export function generateStaticParams() { return supportedLocales.map(lang=>({lang})); }
export async function generateMetadata({params}:{params:Promise<{lang:string}>}):Promise<Metadata> {
 const {lang}=await params;if(!isLocale(lang))notFound();
 const {origin,indexable}=getSiteConfig();
 const title=lang==='es'?'ELEMENTA | Crédito de fotografía':'ELEMENTA | Photography credit';
 const description=lang==='es'?'Autoría, licencia y adaptaciones de la fotografía de Playa Venao utilizada en ELEMENTA.':'Attribution, license and adaptations of the Playa Venao photograph used on ELEMENTA.';
 return localizedMetadata({lang,title,description,origin,indexable,page:'credits'});
}
export default async function Credits({params}:{params:Promise<{lang:string}>}) {
 const {lang}=await params;if(!isLocale(lang))notFound();
 return <main className="document-page"><h1>{lang==='es'?'Crédito de fotografía':'Photography credit'}</h1><p>“Panamá-Playa.JPG” — Inzay20, 2010.</p><p><a href="https://commons.wikimedia.org/wiki/File:Panam%C3%A1-Playa.JPG">Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a></p><p>{lang==='es'?'La fotografía de Playa Venao fue redimensionada a WebP, recortada en pantalla y tratada con color mediante CSS. El material fotográfico adaptado permanece bajo CC BY-SA 3.0; esta licencia no se extiende a las marcas ELEMENTA ni al código del sitio.':'The Playa Venao photograph was resized to WebP, cropped in the viewport and color-treated with CSS. The adapted photographic material remains under CC BY-SA 3.0; this license does not extend to the ELEMENTA marks or site code.'}</p><a href={`/${lang}`}>{copy[lang].back}</a></main>;
}
