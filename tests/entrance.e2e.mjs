import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({headless:true});
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3119';
try {
  for (const locale of ['en','es']) {
    for (const reducedMotion of ['no-preference','reduce']) {
      const page = await browser.newPage({reducedMotion,viewport:{width:390,height:844}});
      await page.addInitScript(() => {
        window.entrances=[];
        const original=Element.prototype.animate;
        Element.prototype.animate=function(frames,options){
          if(this.matches('#main .composition > *')) window.entrances.push({className:this.className,frames,options});
          return original.call(this,frames,options);
        };
      });
      await page.goto(`${base}/${locale}`);
      await page.waitForTimeout(1300);
      const calls=await page.evaluate(()=>window.entrances);
      assert.equal(calls.length,reducedMotion==='reduce'?0:4);
      if(calls.length){
        assert.deepEqual(calls.map(c=>c.options.delay),[0,0,120,240]);
        assert.ok(calls.every(c=>c.options.duration===520 && c.options.iterations===1));
      }
      await page.waitForTimeout(1100);
      assert.equal(await page.evaluate(()=>window.entrances.length),calls.length,'Countdown must not replay entrance');
      for(const selector of ['.brand','.essence','.festival','.release']) assert.equal(await page.locator(selector).evaluate(e=>getComputedStyle(e).opacity),'1');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.close();
    }
    const noJS=await browser.newPage({javaScriptEnabled:false});
    await noJS.goto(`${base}/${locale}`);
    for(const selector of ['.brand','.essence','.festival','.release']) assert.equal(await noJS.locator(selector).evaluate(e=>getComputedStyle(e).opacity),'1');
    await noJS.close();
  }
  console.log('PASS: entrance order/timing, once-only, ES/EN, mobile, reduced motion and no-JS visibility');
} finally {await browser.close();}
