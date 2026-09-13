import assert from 'node:assert/strict';
import {resolve} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('node_modules/.cache/ms-playwright');
const {chromium}=await import('@playwright/test');
const base=process.env.PREVIEW_URL || 'http://127.0.0.1:3118';
const browser=await chromium.launch({headless:true});
try {
 for(const lang of ['es','en']) for(const injected of [false,true]) {
  const context=await browser.newContext();
  // Simulate the opt-out extension's DOM mutation before React hydrates.
  if(injected) await context.addInitScript(()=>{
   const apply=()=>{
    if(!document.documentElement) return false;
    document.documentElement.setAttribute('data-google-analytics-opt-out','');
    return true;
   };
   if(!apply()) {
    const observer=new MutationObserver(()=>{if(apply()) observer.disconnect();});
    observer.observe(document,{childList:true});
   }
  });
  const page=await context.newPage(); const errors=[];
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  page.on('pageerror',e=>errors.push(e.message));
  assert.equal((await page.goto(`${base}/${lang}`)).status(),200);
  await page.waitForTimeout(1500);
  assert.deepEqual(errors,[],`${lang}, injected=${injected}`);
  await page.locator('#email-open').click();
  await page.waitForFunction(()=>document.querySelector('#email-dialog')?.open);
  assert.equal(await page.locator('html').getAttribute('lang'),lang);
  assert.equal(await page.locator('html').getAttribute('data-google-analytics-opt-out'),injected?'':null);
  assert.deepEqual(errors,[],`${lang}, injected=${injected}`);
  console.log(`PASS ${lang}: injected opt-out=${injected}; hydrated dialog works; opt-out preserved`);
  await context.close();
 }
} finally {await browser.close();}
