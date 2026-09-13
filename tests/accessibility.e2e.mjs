import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('node_modules/.cache/ms-playwright');
const {chromium}=await import('@playwright/test');
const {default:AxeBuilder}=await import('@axe-core/playwright');
const browser=await chromium.launch();
const results=[];
try {
 for(const lang of ['es','en']) {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  for(const route of [`/${lang}`,`/${lang}/credits`]) {
   await page.goto((process.env.PREVIEW_URL||'http://localhost:3107')+route);
   const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
   results.push({route,violations:result.violations});
  }
  await page.goto((process.env.PREVIEW_URL||'http://localhost:3107')+`/${lang}`);
  await page.locator('#email-open').click();
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  results.push({route:`/${lang}#signup`,violations:result.violations});
  await page.close();
 }
 await writeFile('docs/verification/accessibility-results.json',JSON.stringify(results,null,2)+'\n');
 for(const r of results) {console.log(r.route,JSON.stringify(r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))));assert.equal(r.violations.length,0,r.route);}
} finally {await browser.close();}
