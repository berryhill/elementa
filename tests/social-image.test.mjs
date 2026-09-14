import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {stat} from 'node:fs/promises';
for (const lang of ['es','en']) test(`${lang} committed social image is a compact opaque landscape JPEG`,async()=>{
 const path=new URL(`../public/assets/elementa-social-${lang}-v1.jpg`,import.meta.url);
 const metadata=await sharp(path.pathname).metadata();
 assert.equal(metadata.width,1200); assert.equal(metadata.height,630);
 assert.equal(metadata.format,'jpeg'); assert.equal(metadata.hasAlpha,false);
 assert((await stat(path)).size < 300_000);
});
