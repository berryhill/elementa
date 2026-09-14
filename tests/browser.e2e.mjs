import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('node_modules/.cache/ms-playwright');
const { chromium, expect } = await import('@playwright/test');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3107';
const output = resolve('docs/verification');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
// Keep synthetic UI checks local: do not load analytics or send QA pageviews.
async function newLocalContext(options = {}) {
  const context = await browser.newContext(options);
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
    ? route.continue() : route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  return context;
}
const results = [];
async function check(name, fn) { await fn(); results.push(name); console.log('PASS', name); }
try {
  for (const lang of ['es', 'en']) {
    for (const [width,height] of [[1440,1000],[390,844],[320,568],[844,390]]) {
      await check(`${lang} ${width}x${height}: layout, assets, metadata, dialog, navigation`, async () => {
        const context = await newLocalContext({ viewport: {width,height} });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
        assert.equal((await page.goto(`${base}/${lang}`)).status(),200);
        await page.locator('body.motion-enabled, body.no-motion').waitFor();
        assert.equal(await page.locator('#motion, #motion-slot').count(),0);
        assert.equal(await page.locator('html').getAttribute('lang'),lang);
        assert.match(await page.title(),/ELEMENTA.*ORIGINS/);
        assert.match(await page.locator('meta[name=robots]').getAttribute('content'),/noindex/);
        assert.equal(await page.locator('link[rel=canonical]').count(),0);
        assert.equal(await page.locator('video').count(),0);
        assert(await page.locator('#festival-dates').isVisible());
        assert(await page.locator('#release-date').isVisible());
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),true);
        await page.screenshot({path:`${output}/${lang}-${width}x${height}.png`,fullPage:true});
        await page.locator('#email-open').click();
        assert.equal(await page.locator('#email-address').evaluate(e=>e===document.activeElement),true);
        await page.locator('.email-submit').click();
        assert.equal(await page.locator('#email-address').evaluate(e=>e.validity.valueMissing),true);
        await page.locator('#email-address').fill('not-an-email');
        assert.equal(await page.locator('#email-address').evaluate(e=>e.validity.typeMismatch),true);
        await page.locator('#email-address').fill('elementa-qa@example.invalid');
        await page.locator('.email-submit').click();
        assert.equal(await page.locator('input[type=checkbox]').evaluate(e=>e.validity.valueMissing),true);
        await page.locator('input[type=checkbox]').check();
        const requests = [];
        await page.route('**/api/signup', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})}));
        page.on('request', r=>{if(['fetch','xhr'].includes(r.resourceType()))requests.push(r.url());});
        await page.locator('.email-submit').click();
        await expect(page.locator('#email-dialog [role=status]')).toContainText(lang==='es'?'Tu suscripción está guardada':'Your subscription is saved');
        assert.deepEqual(requests,[base+'/api/signup']);
        assert.equal(await page.locator('#email-address').inputValue(),'');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#email-dialog').evaluate(e=>e.open),false);
        assert.equal(await page.locator('#email-open').evaluate(e=>e===document.activeElement),true);
        assert.equal(await page.locator('#photo-credit, footer, #motion, #motion-slot').count(),0);
        assert.equal(await page.getByText(/^(Fotografía|Photography|Pausar movimiento|Pause motion)$/).count(),0);
        await page.goto(`${base}/${lang}/credits`);
        assert.equal((await page.locator('html').getAttribute('lang')),lang);
        assert.match(await page.locator('main').innerText(),/CC BY-SA 3.0/);
        await page.locator(`main a[href="/${lang}"]`).click();
        await page.locator(lang==='es'?'#en':'#es').click();
        assert.equal(await page.locator('html').getAttribute('lang'),lang==='es'?'en':'es');
        assert.deepEqual(errors,[]);
        await context.close();
      });
    }
  }
  await check('expiry without a motion button in both languages using controlled browser clock', async()=>{
    for(const lang of ['es','en']) {
      const context=await newLocalContext(); const page=await context.newPage();
      await page.clock.install({time:new Date('2026-09-30T23:59:57-05:00')});
      await page.goto(`${base}/${lang}`); await page.locator('body.motion-enabled, body.no-motion').waitFor();
        assert.equal(await page.locator('#motion, #motion-slot').count(),0);
      await page.clock.fastForward(5000);
      await page.locator('#release-state').waitFor();
      assert.equal(await page.locator('#countdown').count(),0);
      assert.equal(await page.locator('#countdown-label').innerText(),lang==='es'?'Lineup y entradas':'Lineup & tickets');
      assert.match(await page.locator('#release-state').innerText(),lang==='es'?/Próximamente/:/coming soon/);
      await context.close();
    }
  });
  await check('reduced motion freezes ambient animation and countdown',async()=>{
    const context=await newLocalContext({reducedMotion:'reduce'});const page=await context.newPage();
    await page.goto(`${base}/en`);await page.locator('body.motion-enabled, body.no-motion').waitFor();
        assert.equal(await page.locator('#motion, #motion-slot').count(),0);
    assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('no-motion')),true);
    assert.equal(await page.locator('#coast').evaluate(e=>getComputedStyle(e).animationName),'none');
    const before=await page.locator('#countdown').innerText();await page.waitForTimeout(1200);
    assert.equal(await page.locator('#countdown').innerText(),before);await context.close();
  });
  await check('no-JavaScript pages and 404 recovery are server-rendered',async()=>{
    const context=await newLocalContext({javaScriptEnabled:false});const page=await context.newPage();
    for(const lang of ['es','en']) {
      await page.goto(`${base}/${lang}`);
      assert.equal(await page.locator('html').getAttribute('lang'),lang);
      assert(await page.locator('#festival-dates').isVisible());
      assert.doesNotMatch(await page.locator('#countdown').innerText(),/—/);
      assert.equal(await page.locator('#email-open').isDisabled(),true);
    }
    for(const path of ['/fr','/fr/credits','/ES','/404','/en/missing']) {
      const response=await page.goto(base+path);assert.equal(response.status(),404,path);
      assert.match(await page.title(),/404/);
      assert.equal(await page.locator('main a[href="/es"]').count(),1,path);
      assert(await page.locator('html').getAttribute('lang'));
    }
    await context.close();
  });
  await check('HTTP root, metadata endpoints, design assets and preview isolation',async()=>{
    const root=await fetch(base,{redirect:'manual'});assert.equal(root.status,307);assert.equal(root.headers.get('location'),'/es');
    for(const asset of ['playa-venao.webp','elementa-emblem.png','elementa-wordmark.png','grain.svg']) assert.equal((await fetch(`${base}/assets/${asset}`)).status,200);
    assert.match(await (await fetch(base+'/robots.txt')).text(),/Allow: \//);
    assert.doesNotMatch(await (await fetch(base+'/sitemap.xml')).text(),/<loc>/);
    for(const lang of ['es','en']) for(const userAgent of ['Mozilla/5.0','Googlebot','facebookexternalhit/1.1']) {
      const res=await fetch(`${base}/${lang}`,{headers:{'user-agent':userAgent,'x-elementa-locale':lang==='es'?'en':'es'}});
      const html=await res.text();assert.equal(res.status,200);assert.match(html,new RegExp(`<html lang="${lang}"`));
      assert.match(html,/noindex/);assert.match(html,/name="description"/);assert.match(html,/property="og:title"/);
      assert.doesNotMatch(html,/application\/ld\+json|rel="canonical"/);
    }
  });
  await writeFile(`${output}/browser-results.json`,JSON.stringify({base,passed:results.length,checks:results,signup:'API success mocked; no live MongoDB persistence verified.'},null,2)+'\n');
} finally { await browser.close(); }
