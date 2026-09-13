import type {MetadataRoute} from 'next';
import {getSiteConfig} from '@/lib/site';
import {localeAlternates,supportedLocales} from '@/lib/localization';
export default function sitemap():MetadataRoute.Sitemap {const {origin,indexable}=getSiteConfig();return origin&&indexable?supportedLocales.map(lang=>({url:`${origin}/${lang}`,alternates:{languages:localeAlternates(origin)}})):[];}
