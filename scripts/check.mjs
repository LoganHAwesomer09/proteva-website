import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root } from './build.mjs';
for (const name of ['index.html','app.html','me.html']) {
  const html=await readFile(path.join(root,name),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(ids.length,new Set(ids).size,name+': duplicate HTML IDs');
  assert.ok(!/\son(?:click|submit|change|keydown)=/i.test(html),name+': inline event handlers');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html),name+': inline executable scripts');
  for (const [,url] of html.matchAll(/(?:src|href)="(\/[^"#?]+)(?:[^"]*)"/g)) {
    if (url==='/' || url.startsWith('/vendor/')) continue;
    await access(path.join(root,url.slice(1)));
  }
}
const config=JSON.parse(await readFile(path.join(root,'vercel.json'),'utf8'));
assert.equal(config.outputDirectory,'dist');
assert.ok(config.headers[0].headers.some(h=>h.key==='Content-Security-Policy'));
console.log('Page references, unique IDs, script policy, and deployment configuration passed.');
