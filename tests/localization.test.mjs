import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultLocale,supportedLocales,localeHeader,localeRequestHeaders,localeFromPath,localeAlternates,localizedMetadata,analyticsPageContext,isRejectedLocalePage} from '../src/lib/localization.ts';
import {getSiteConfig} from '../src/lib/site.ts';
import {copy,festival,isLocale} from '../src/content/festival.ts';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
test('stable Spanish fallback and independent locales',()=>{assert.equal(defaultLocale,'es');assert.equal(localeFromPath('/es'),'es');assert.equal(localeFromPath('/en/credits'),'en');assert.equal(localeFromPath('/fr'),null);assert.equal(localeFromPath('/english'),null);});
test('locale parsing does not confuse query parameters for path',()=>{assert.equal(localeFromPath('/en?language=es'),'en');assert.equal(localeFromPath('/es#en'),'es');});
test('alternate URLs are reciprocal with deliberate Spanish fallback',()=>assert.deepEqual(localeAlternates('https://example.org'),{es:'https://example.org/es',en:'https://example.org/en','x-default':'https://example.org/es'}));
test('GA content language comes from visited URL, not browser settings',()=>{assert.deepEqual(analyticsPageContext('/es'),{content_language:'es',page_type:'landing'});assert.deepEqual(analyticsPageContext('/en'),{content_language:'en',page_type:'landing'});});
test('measurement context excludes query strings, fragments, PII and unknown pages',()=>{assert.deepEqual(analyticsPageContext('/es/credits?email=private@example.org#token'),{content_language:'es',page_type:'credits'});assert.equal(analyticsPageContext('/en/private'),null);assert.equal(analyticsPageContext('/fr'),null);});

test('URL locale overwrites spoofed headers without changing the input',()=>{
  const input=new Headers({[localeHeader]:'es',accept:'text/html'});
  for(const [path,expected] of [['/en','en'],['/en/credits','en'],['/es','es'],['/fr','es'],['/','es']]) {
    const result=localeRequestHeaders(path,input);
    assert.equal(result.get(localeHeader),expected);
    assert.equal(result.get('accept'),'text/html');
  }
  assert.equal(input.get(localeHeader),'es');
});
test('supported route locales agree with the content model',()=>{
  assert.deepEqual(supportedLocales,['es','en']);
  for(const lang of supportedLocales) {assert(isLocale(lang));assert(copy[lang].description);}
  for(const path of ['/','/fr','/EN','/espanol','//en','/english/credits']) assert.equal(localeFromPath(path),null);
});
const landingMetadata=(lang,config)=>localizedMetadata({lang,title:`${festival.officialName} ${festival.editionName} | ${copy[lang].location}`,description:copy[lang].description,...config});
test('both preview locales omit all public discovery URLs even with an origin',()=>{
  for(const lang of supportedLocales) for(const origin of [undefined,'https://example.org']) {
    const metadata=landingMetadata(lang,getSiteConfig({SITE_ORIGIN:origin,NODE_ENV:'production'}));
    assert.deepEqual(metadata.robots,{index:false,follow:false});
    assert.match(metadata.title,lang==='es'?/Vista previa$/:/Preview$/);
    assert.equal(metadata.description,copy[lang].description);
    assert.equal(metadata.metadataBase,undefined);
    assert.equal(metadata.alternates,undefined);
    assert.equal(metadata.openGraph.url,undefined);
    assert.equal(metadata.openGraph.images,undefined);
    assert.equal(metadata.twitter.images,undefined);
    assert.equal(metadata.openGraph.title,metadata.title);
    assert.equal(metadata.twitter.description,metadata.description);
  }
});
test('future public metadata helper has self canonicals and reciprocal alternates (not launch authorization)',()=>{
  for(const lang of supportedLocales) {
    const metadata=landingMetadata(lang,{origin:'https://example.org',indexable:true});
    assert.deepEqual(metadata.robots,{index:true,follow:true});
    assert.equal(metadata.metadataBase.origin,'https://example.org');
    assert.equal(metadata.alternates.canonical,`/${lang}`);
    assert.deepEqual(metadata.alternates.languages,localeAlternates('https://example.org'));
    assert.equal(metadata.openGraph.url,`https://example.org/${lang}`);
    assert.equal(metadata.openGraph.images[0].url,'https://example.org/assets/elementa-wordmark.png');
    assert.equal(metadata.twitter.images[0],metadata.openGraph.images[0].url);
    assert.doesNotMatch(metadata.title,/Preview|Vista previa/);
  }
  assert.throws(()=>landingMetadata('es',{indexable:true}),/approved origin/);
});
test('credits never advertise landing-page canonicals or indexable translations',()=>{
  for(const lang of supportedLocales) for(const indexable of [false,true]) {
    const metadata=localizedMetadata({lang,title:'ELEMENTA | Credit',description:'Attribution',origin:'https://example.org',indexable,page:'credits'});
    assert.deepEqual(metadata.robots,{index:false,follow:false});
    assert.equal(metadata.alternates,undefined);
    assert.equal(metadata.openGraph.url,undefined);
  }
});
test('invalid and loopback origins produce an actionable configuration error',()=>{
  for(const origin of ['not a URL','https://localhost.','https://preview.localhost','https://127.0.0.1','https://127.1','https://[::1]','https://0.0.0.0']) {
    assert.throws(()=>getSiteConfig({SITE_ORIGIN:origin}),/SITE_ORIGIN must be a public HTTPS origin/);
  }
});
test('approval flags cannot accidentally enable the unfinished public release',()=>{
  for(const facts of [undefined,'false','TRUE','true']) for(const instant of [undefined,'false','TRUE','true']) {
    assert.throws(()=>getSiteConfig({SITE_STAGE:'public-teaser',SITE_ORIGIN:'https://example.org',FESTIVAL_FACTS_APPROVED:facts,ANNOUNCEMENT_INSTANT_APPROVED:instant}),facts==='true'&&instant==='true'?/signup destination and privacy policy/:/approved festival facts/);
  }
});

// Execute the actual non-JSX metadata routes using only Node's type stripper.
// Resolving local aliases here does NOT simulate Next's renderer or HTTP layer.
async function loadMetadataRoute(relativePath) {
  const source=await readFile(new URL(relativePath,import.meta.url),'utf8');
  const javascript=stripTypeScriptTypes(source).replace(/(['"])@\/lib\/(site|localization)\1/g,(_,quote,name)=>JSON.stringify(new URL(`../src/lib/${name}.ts`,import.meta.url).href));
  return import(`data:text/javascript,${encodeURIComponent(javascript)}`);
}
const {default:robots}=await loadMetadataRoute('../src/app/robots.ts');
const {default:sitemap}=await loadMetadataRoute('../src/app/sitemap.ts');
function withSiteEnv(values,run) {
  const keys=['SITE_STAGE','SITE_ORIGIN','FESTIVAL_FACTS_APPROVED','ANNOUNCEMENT_INSTANT_APPROVED'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    for(const key of keys) {if(values[key]===undefined)delete process.env[key];else process.env[key]=values[key];}
    run();
  } finally {
    for(const key of keys) {if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  }
}
test('actual preview robots allows noindex retrieval; actual sitemap stays empty',()=>{
  for(const origin of [undefined,'https://example.org']) withSiteEnv({SITE_ORIGIN:origin},()=>{
    assert.deepEqual(robots(),{rules:{userAgent:'*',allow:'/'}});
    assert.deepEqual(sitemap(),[]);
  });
});
test('actual robots and sitemap cannot bypass the public launch gate',()=>{
  withSiteEnv({SITE_STAGE:'public-teaser',SITE_ORIGIN:'https://example.org',FESTIVAL_FACTS_APPROVED:'true',ANNOUNCEMENT_INSTANT_APPROVED:'true'},()=>{
    assert.throws(()=>robots(),/signup/);assert.throws(()=>sitemap(),/signup/);
  });
});

test('invalid locale page shapes are rejected without intercepting real routes',()=>{
  for(const path of ['/fr','/fr/credits','/ES','/ES/credits','/EN','/english','/fr/','/404','/404/']) assert.equal(isRejectedLocalePage(path),true,path);
  for(const path of ['/','/es','/en','/es/credits','/en/credits','/robots.txt','/sitemap.xml','/favicon.ico','/es/unknown','/fr/unknown/nested','/assets/elementa-emblem.png','/_next/static/chunk.js']) assert.equal(isRejectedLocalePage(path),false,path);
});

// Source-contract checks only: these cannot establish emitted HTML or HTTP 404s.
test('404 rewrite reuses the recovery UI with an explicit status and native error title',async()=>{
  const proxy=await readFile(new URL('../src/proxy.ts',import.meta.url),'utf8');
  const layout=await readFile(new URL('../src/app/layout.tsx',import.meta.url),'utf8');
  const errorPage=await readFile(new URL('../src/app/404/page.tsx',import.meta.url),'utf8');
  assert.match(proxy,/if\(isRejectedLocalePage\(request.nextUrl.pathname\)\)/);
  assert.match(proxy,/destination.pathname='\/404'/);
  assert.match(proxy,/NextResponse.rewrite\(destination,\{status:404,request:\{headers:requestHeaders\}\}\)/);
  assert.match(layout,/title:'ELEMENTA \| 404/);
  assert.match(layout,/robots:\{index:false,follow:false\}/);
  assert.match(errorPage,/export \{default\} from '\.\.\/not-found'/);
});
test('route source preserves server rendering, locale allowlists and real navigation',async()=>{
  const landing=await readFile(new URL('../src/app/[lang]/page.tsx',import.meta.url),'utf8');
  const credits=await readFile(new URL('../src/app/[lang]/credits/page.tsx',import.meta.url),'utf8');
  const layout=await readFile(new URL('../src/app/layout.tsx',import.meta.url),'utf8');
  const root=await readFile(new URL('../src/app/page.tsx',import.meta.url),'utf8');
  const proxy=await readFile(new URL('../src/proxy.ts',import.meta.url),'utf8');
  for(const source of [landing,credits]) {
    assert.doesNotMatch(source,/['"]use client['"]/);
    assert.match(source,/export const dynamicParams\s*=\s*false/);
    assert.match(source,/supportedLocales\.map\(lang=>\(\{lang\}\)\)/);
    assert.equal((source.match(/if\s*\(!isLocale\(lang\)\)\s*notFound\(\)/g)||[]).length,2);
    assert.match(source,/return localizedMetadata\(/);
  }
  assert.match(landing,/<a id="es" href="\/es"/);
  assert.match(landing,/<a id="en" href="\/en"/);
  assert.match(landing,/indexable && origin && <script type="application\/ld\+json"/);
  assert.match(layout,/await headers\(\)/);
  assert.match(layout,/<html lang=\{lang\}>/);
  assert.match(layout,/getSiteConfig\(\)/);
  assert.match(root,/redirect\('\/es'\)/);
  assert.match(proxy,/localeRequestHeaders\(request.nextUrl.pathname,request.headers\)/);
  assert.match(proxy,/NextResponse.next\(\{request:\{headers:requestHeaders\}\}\)/);
  for(const path of ['../middleware.ts','../src/middleware.ts','../middleware.js','../src/middleware.js']) assert.equal(existsSync(new URL(path,import.meta.url)),false,'Proxy must not coexist with redundant middleware');
});
