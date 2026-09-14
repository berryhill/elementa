import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3118';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const snapshot = page => page.evaluate(() => [...document.querySelectorAll('.composition > *')].map(e => ({opacity:getComputedStyle(e).opacity,transform:getComputedStyle(e).transform,y:e.getBoundingClientRect().y})));
try {
  for (const lang of ['es','en']) for (const width of [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:900}});
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    let release; const gate = new Promise(resolve => { release = resolve; });
    await context.route('**/_next/**/*.js', async route => { await gate; await route.continue(); });
    await context.addInitScript(() => {
      window.arrivals=[];
      const animate=Element.prototype.animate;
      Element.prototype.animate=function(frames,options){const a=animate.call(this,frames,options);window.arrivals.push({target:this.className,frames,options,a});return a;};
    });
    const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${base}/${lang}`,{waitUntil:'commit'});
    await page.locator('.composition').waitFor(); await page.waitForTimeout(350);
    const before=await snapshot(page); assert(before.every(e=>e.opacity==='1'));
    release(); await page.waitForFunction(()=>window.arrivals.length===1);
    const samples=[];
    for(const time of [0,220,440,800,1100,1600]) {
      await page.evaluate(t=>{window.arrivals[0].a.pause();window.arrivals[0].a.currentTime=t;},time);
      const current=await snapshot(page); assert.deepEqual(current,before);
      samples.push({time,opacity:await page.locator('.tide').evaluate(e=>getComputedStyle(e).opacity)});
      if(time===440 && process.env.SCREENSHOT_DIR) await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/entrance-${lang}-${width}.png`});
    }
    // Simulate the existing motion-state contract, not a removed UI button.
    await page.evaluate(()=>{window.arrivals[0].a.currentTime=300;window.arrivals[0].a.play();document.body.classList.add('no-motion');});
    await page.waitForFunction(()=>window.arrivals[0].a.playState==='idle');
    await page.evaluate(()=>document.body.classList.remove('no-motion'));
    await page.waitForTimeout(1200); assert.equal(await page.evaluate(()=>window.arrivals.length),1);
    assert.equal(await page.locator('.tide').evaluate(e=>getComputedStyle(e).opacity),'0.3');
    assert.equal(await page.locator('#motion, #motion-slot').count(),0);
    assert.deepEqual(errors,[]); console.log(JSON.stringify({lang,width,samples,delayedHydration:'stable',pause:'cancelled',resume:'no replay',countdown:'no retrigger'}));
    await context.close();
    for(const mode of ['reduce','runtime','no-js']) {
      const c=await browser.newContext({viewport:{width,height:900},reducedMotion:mode==='reduce'?'reduce':'no-preference',javaScriptEnabled:mode!=='no-js'});
      await c.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
      const p=await c.newPage(); await p.goto(`${base}/${lang}`);
      if(mode==='runtime'){await p.emulateMedia({reducedMotion:'reduce'});await p.waitForTimeout(100);}
      assert((await snapshot(p)).every(e=>e.opacity==='1'));
      assert.equal(await p.locator('.tide').evaluate(e=>getComputedStyle(e).opacity),'0.3');
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      console.log(`PASS ${lang} ${width} ${mode}`); await c.close();
    }
  }
} finally { await browser.close(); }
