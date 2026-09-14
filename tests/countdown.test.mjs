import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownValues } from '../src/lib/countdown.ts';
import {getSiteConfig,serializeJsonLd} from '../src/lib/site.ts';
import {festival,copy,isLocale} from '../src/content/festival.ts';
const end=Date.parse(festival.announcementAt);
test('October 15 announcement preserves Panama midnight and festival dates',()=>{
  assert.equal(festival.announcementAt,'2026-10-15T00:00:00-05:00');
  assert.equal(festival.announcementTimeZone,'America/Panama');
  assert.equal(festival.festivalStartDate,'2027-02-19');
  assert.equal(festival.festivalEndDate,'2027-02-20');
  for(const [lang,date] of [['en','October 15, 2026'],['es','15 de octubre de 2026']]) {
    assert.equal(copy[lang].releaseDate,date);
    assert(copy[lang].releaseTime.startsWith(`${date}, 00:00,`));
    assert(copy[lang].description.includes(lang==='en'?'October 15.':'15 de octubre.'));
  }
  assert.deepEqual(countdownValues(festival.announcementAt,Date.parse('2026-10-01T05:00:00Z')),['14','00','00','00']);
});
test('announcement and festival are separate, in chronological order',()=>{assert.notEqual(festival.announcementAt.slice(0,10),festival.festivalStartDate);assert(end<Date.parse(festival.festivalStartDate));});
test('explicit timezone represents the same instant as UTC',()=>{assert.equal(end,Date.parse('2026-10-15T05:00:00Z'));});
test('day/hour/minute/second decomposition',()=>{assert.deepEqual(countdownValues(festival.announcementAt,end-90061000),['01','01','01','01']);});
test('one second before release',()=>assert.deepEqual(countdownValues(festival.announcementAt,end-1000),['00','00','00','01']));
test('at/after release cannot produce negative countdown',()=>{assert.equal(countdownValues(festival.announcementAt,end),null);assert.equal(countdownValues(festival.announcementAt,end+1000),null);});
test('milliseconds round upward until actual release',()=>assert.deepEqual(countdownValues(festival.announcementAt,end-1),['00','00','00','01']));
test('timezone-less, invalid target and invalid current time are rejected',()=>{assert.throws(()=>countdownValues('2026-10-15T00:00:00',end));assert.throws(()=>countdownValues('brokenZ',end));assert.throws(()=>countdownValues(festival.announcementAt,NaN));});
test('preview is default even for production-mode builds',()=>{assert.equal(getSiteConfig({NODE_ENV:'production'}).indexable,false);assert.equal(getSiteConfig({}).origin,undefined);});
test('public release is fail-closed',()=>{assert.throws(()=>getSiteConfig({SITE_STAGE:'public-teaser'}));assert.throws(()=>getSiteConfig({SITE_STAGE:'public-teaser',SITE_ORIGIN:'https://example.org',FESTIVAL_FACTS_APPROVED:'true',ANNOUNCEMENT_INSTANT_APPROVED:'true'}),/signup/);});
test('invalid canonical origins and unknown stages rejected',()=>{for(const origin of ['http://example.org','https://user:password@example.org','https://example.org/path','https://example.org/?a=1','https://example.org/#hash','https://localhost']) assert.throws(()=>getSiteConfig({SITE_ORIGIN:origin}));assert.throws(()=>getSiteConfig({SITE_STAGE:'typo'}));});
test('configured preview origin normalized',()=>assert.equal(getSiteConfig({SITE_ORIGIN:'https://example.org/'}).origin,'https://example.org'));
test('JSON-LD resists script-breakout and preserves content',()=>{const value={name:'</script><script>alert(1)</script>'};const output=serializeJsonLd(value);assert(!output.includes('<'));assert.deepEqual(JSON.parse(output),value);});
test('locales and source countdown labels preserved',()=>{assert(isLocale('es')&&isLocale('en'));assert(!isLocale('fr'));assert.equal(copy.en.countdown,'Lineup & tickets release in');assert.equal(copy.es.countdown,'El lineup y las entradas llegan en');assert.equal(copy.en.units.length,4);assert.equal(copy.es.units.length,4);});
