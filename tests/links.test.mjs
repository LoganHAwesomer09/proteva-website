import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkLinks,analyzeUrl,extractUrls} from '../lib/links.js';

const one=text=>{ const links=checkLinks(text); assert.equal(links.length,1,text); return links[0]; };

test('common scam link tricks are flagged high risk with the impersonated company',()=>{
  for (const [text,domain,real] of [
    ['Your account is locked: http://paypa1-secure.com/login','paypa1-secure.com','paypal.com'],
    ['https://paypal.com.account-verify.xyz/update','account-verify.xyz','paypal.com'],
    ['Track your parcel: ups-delivery-update.com','ups-delivery-update.com','ups.com'],
    ['https://amaz0n-refunds.top/claim','amaz0n-refunds.top','amazon.com'],
    ['www.irs-gov-refund.com/pay','irs-gov-refund.com','irs.gov'],
    ['https://chase-alerts.net','chase-alerts.net','chase.com'],
    ['https://xn--pypal-4ve.com','xn--pypal-4ve.com','paypal.com'],
    ['https://secure.wellsfargo.com.wf-online.icu/login','wf-online.icu','wellsfargo.com'],
    ['Call Geek Squad at geeksquad-renewal.com','geeksquad-renewal.com','geeksquad.com']
  ]) {
    const link=one(text);
    assert.equal(link.domain,domain); assert.equal(link.risk,'high',text); assert.equal(link.impersonates,real,text);
  }
});

test('address tricks without a brand are still flagged',()=>{
  assert.deepEqual(one('http://192.168.4.20/office365').signals,['ip-address']);
  assert.ok(one('https://user@evil.example.com').signals.includes('user-info'));
  const short=one('Open https://bit.ly/3xYz');
  assert.equal(short.risk,'medium'); assert.deepEqual(short.signals,['shortened']);
  assert.equal(one('https://cheap-deals.xyz').risk,'medium');
});

test('real company sites and everyday words are not flagged',()=>{
  for (const text of ['https://www.paypal.com/signin','https://amazon.com/orders','https://www.chase.com','see google.com','https://www.irs.gov/refunds','apply now at apply-now.com','meet at purchase-deals.com','https://grandkids-photos.com','https://www.usps.com/track','https://secure.chase.com/login','https://www.icloud.com']) {
    const link=one(text);
    assert.equal(link.risk,'low',text); assert.deepEqual(link.signals,[],text); assert.equal(link.impersonates,null,text);
  }
});

test('plain http is noted only for links written with a scheme',()=>{
  assert.deepEqual(one('http://example.com').signals,['not-secure']);
  assert.deepEqual(one('example.com').signals,[]);
});

test('link extraction skips emails, file names and non-domains, de-duplicates, and caps the list',()=>{
  assert.deepEqual(checkLinks('Email bob@gmail.com, open report.pdf, version 1.2.3, at 3.30pm'),[]);
  assert.equal(checkLinks('paypa1.com and http://paypa1.com/x and https://paypa1.com').length,1);
  const many=Array.from({length:15},(_,i)=>'site'+i+'.com').join(' ');
  assert.equal(extractUrls(many).length,10);
  assert.deepEqual(checkLinks(''),[]); assert.deepEqual(checkLinks(undefined),[]);
});

test('results contain only domains and fixed signal IDs, never paths or query strings',()=>{
  const [link]=checkLinks('https://paypa1.com/reset?token=SECRET123&email=rose@example.com');
  assert.ok(!JSON.stringify(link).includes('SECRET123'));
  assert.ok(!JSON.stringify(link).includes('rose@'));
  assert.deepEqual(Object.keys(link).sort(),['domain','impersonates','risk','signals']);
  assert.equal(analyzeUrl('https://example.com').risk,'low');
});

test('carriers, card issuers, payment apps and toll texts are covered',()=>{
  for (const [text,real] of [['verizon-billing-update.com','verizon.com'],['https://t-mobile-rewards.top','t-mobile.com'],['xfinity-account-alert.net','xfinity.com'],['capital0ne-secure.com','capitalone.com'],['cashapp-refund.support','cash.app'],['https://ezpass-unpaid-toll.com/pay','e-zpassny.com']]) {
    const [link]=checkLinks(text);
    assert.equal(link.risk,'high',text); assert.equal(link.impersonates,real,text);
  }
  for (const text of ['https://www.verizon.com','https://www.t-mobile.com/account','https://cash.app/$rose','https://www.capitalone.com','discovery-museum.org','spectrum-health.org','https://linkedin.com/in/rose']) {
    const [link]=checkLinks(text);
    assert.deepEqual(link.signals,[],text);
  }
});
