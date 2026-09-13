import type {MetadataRoute} from 'next';
import {getSiteConfig} from '@/lib/site';
export default function robots():MetadataRoute.Robots {const {origin,indexable}=getSiteConfig();return {rules:{userAgent:'*',allow:'/'},...(indexable&&origin?{sitemap:`${origin}/sitemap.xml`}:{})};}
