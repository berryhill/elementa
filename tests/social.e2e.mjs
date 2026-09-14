import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
const base=process.env.BASE_URL||'http://localhost:3199';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true});
try {
 const context=await browser.newContext({reducedMotion:'reduce'});
 // Never send synthetic analytics hits or third-party scripts.
 await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
 const page=await context.newPage();
 for(const lang of ['es','en']) {
  for(const ua of ['Mozilla/5.0','WhatsApp/2.24.7.81 A','facebookexternalhit/1.1']) {
   const r=await fetch(`${base}/${lang}`,{headers:{'user-agent':ua}});
   assert.equal(r.status,200); const html=await r.text();
   assert.match(html,/<meta name="robots" content="noindex, nofollow"/);
   assert.doesNotMatch(html.match(/<title>(.*?)<\/title>/s)?.[1]||'',/Preview|Vista previa/);
   assert.match(html,new RegExp(`https://elementafestival.com/assets/elementa-social-${lang}-v1.jpg`));
   assert.match(html,/content="summary_large_image"/);
   const image=await fetch(`${base}/assets/elementa-social-${lang}-v1.jpg`,{headers:{'user-agent':ua}});
   assert.equal(image.status,200); assert.match(image.headers.get('content-type'),/image\/jpeg/);
   const bytes=Buffer.from(await image.arrayBuffer()); const m=await sharp(bytes).metadata();
   assert.equal(m.width,1200); assert.equal(m.height,630);
   console.log(lang,ua,r.status,image.status,bytes.length);
  }
  await page.goto(`${base}/${lang}`); await page.waitForSelector('#logo');
  assert.equal(await page.locator('html').getAttribute('lang'),lang);
  assert.doesNotMatch(await page.title(),/Preview|Vista previa/);
  assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'),`https://elementafestival.com/assets/elementa-social-${lang}-v1.jpg`);
  await page.screenshot({path:`/tmp/elementa-social-${lang}.png`});
 }
 await page.goto(base); assert.equal(new URL(page.url()).pathname,'/es');
 console.log('browser, root Spanish redirect and crawler checks passed',base);
} finally {await browser.close();}
