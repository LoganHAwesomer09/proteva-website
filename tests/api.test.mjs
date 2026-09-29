import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/check-scam.js';
import demo from '../api/generate-threat.js';
import {parseAssessment,withinRateLimit} from '../lib/server.js';
import {MAX_CHECK_BYTES,MAX_IMAGE_BYTES} from '../assets/checker-limits.js';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVp0AAAAASUVORK5CYII=';

function response() {
  return {code:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
}
function request(body={message:'Please send a payment urgently.'},headers={}) {
  return {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-session-token',...headers},body};
}
function mockFetch(t,options={}) {
  const calls=[];
  const userId=options.userId || crypto.randomUUID();
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    calls.push({url:String(url),init});
    if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify(options.authInvalid?{message:'Invalid token'}:{id:userId,email:'caregiver@example.test',is_anonymous:!!options.anonymous}),{status:options.authInvalid?401:200,headers:{'Content-Type':'application/json'}});
    if (String(url).includes('/rest/v1/scam_checks')) {
      if (options.saveThrows) throw new Error('private database error');
      return new Response(options.saveError?JSON.stringify({message:'private database error'}):null,{status:options.saveError?403:201});
    }
    if (options.reject) throw new Error('private provider error');
    return new Response(JSON.stringify(options.providerError?{error:'private provider error'}:{content:[{type:'text',text:options.text || JSON.stringify({verdict:'caution',headline:'Check this independently',why:'The request asks for urgent payment.',whatToDo:'Contact the sender using a number you already trust.'})}]}),{status:options.providerError?429:200,headers:{'Content-Type':'application/json'}});
  });
  return calls;
}
test('only POST is allowed and responses cannot be cached',async()=>{
  const res=response(); await handler({method:'GET',headers:{}},res);
  assert.equal(res.code,405); assert.equal(res.headers.Allow,'POST'); assert.equal(res.headers['Cache-Control'],'no-store');
});
test('malformed JSON, arrays, nonstrings, short, and oversized inputs fail before provider access',async t=>{
  const calls=mockFetch(t);
  for (const body of ['{',[],{message:{}},{message:' '},{message:'a'.repeat(4001)}]) {
    const res=response(); await handler(request(body),res); assert.equal(res.code,400);
  }
  assert.equal(calls.length,0);
});
test('non-JSON content type is rejected',async()=>{
  const res=response(); await handler(request({message:'hello'},{'content-type':'text/plain'}),res); assert.equal(res.code,415);
});
test('missing auth is rejected without a provider call',async t=>{
  const calls=mockFetch(t); const res=response();
  await handler(request({message:'hello'},{authorization:''}),res); assert.equal(res.code,401); assert.equal(calls.length,0);
});
test('invalid tokens and anonymous accounts are rejected',async t=>{
  for(const options of [{authInvalid:true},{anonymous:true}]) {
    const calls=mockFetch(t,options),res=response(); await handler(request(),res);
    assert.equal(res.code,401); assert.equal(calls.length,1); t.mock.restoreAll();
  }
});
test('authenticated checks return only validated output and isolate message from system instructions',async t=>{
  process.env.ANTHROPIC_API_KEY='test-placeholder';
  const calls=mockFetch(t),res=response(); await handler(request(),res);
  assert.equal(res.code,200); assert.equal(res.body.result.verdict,'caution');
  const sent=JSON.parse(calls[1].init.body);
  assert.ok(sent.system.includes('UNTRUSTED DATA'));
  assert.deepEqual(sent.messages[0].content,[{type:'text',text:request().body.message}]);
  assert.equal(res.body.historySaved,true);
  const saved=JSON.parse(calls[2].init.body);
  assert.equal(saved.snippet,'');
  assert.equal(saved.was_photo,false);
  assert.equal(new Headers(calls[2].init.headers).get('authorization'),'Bearer test-session-token');
  assert.ok(!calls[2].init.body.includes(request().body.message));
  assert.ok(!JSON.stringify(res.body).includes('test-placeholder'));
  delete process.env.ANTHROPIC_API_KEY;
});
test('missing provider configuration returns a safe unavailable response',async t=>{
  delete process.env.ANTHROPIC_API_KEY; mockFetch(t);
  const res=response(); await handler(request(),res); assert.equal(res.code,503);
  assert.ok(!JSON.stringify(res.body).includes('API_KEY'));
});
test('provider failure, thrown timeout, and invalid model output never leak details',async t=>{
  process.env.ANTHROPIC_API_KEY='test-placeholder';
  for(const options of [{providerError:true},{reject:true},{text:'not JSON'},{text:'{"verdict":"safe","headline":{},"why":"a","whatToDo":"b"}'}]) {
    mockFetch(t,options); const res=response(); await handler(request(),res);
    assert.equal(res.code,502); assert.ok(!JSON.stringify(res.body).includes('private provider error')); t.mock.restoreAll();
  }
  delete process.env.ANTHROPIC_API_KEY;
});
test('verdict shape is strict, including unknown tags and malformed fields',()=>{
  assert.throws(()=>parseAssessment('{"verdict":"unknown","headline":"a","why":"b","whatToDo":"c"}'));
  assert.throws(()=>parseAssessment('null'));
  assert.throws(()=>parseAssessment('{"verdict":"safe","headline":"","why":"b","whatToDo":"c"}'));
});
test('rate limiter rejects bursts and permits the next window',()=>{
  for(let i=0;i<10;i++) assert.equal(withinRateLimit('rate-test',response(),1000),true);
  const res=response(); assert.equal(withinRateLimit('rate-test',res,1000),false);
  assert.equal(res.code,429); assert.equal(res.headers['Retry-After'],'60');
  assert.equal(withinRateLimit('rate-test',response(),61001),true);
});
test('sample endpoint requires sign-in and makes no AI request',async t=>{
  const calls=mockFetch(t,{userId:'demo-test'}),res=response();
  await demo(request({}),res); assert.equal(res.code,200);
  assert.ok(res.body.text.startsWith('Sample:')); assert.equal(calls.length,1);
});

test('photo-only and photo-plus-note requests preserve the image and save only the assessment',async t=>{
  process.env.ANTHROPIC_API_KEY='test-placeholder';
  t.after(()=>delete process.env.ANTHROPIC_API_KEY);
  for (const message of ['', 'A', 'A suspicious message']) {
    const calls=mockFetch(t,{userId:'image-'+message}),res=response();
    await handler(request({message,image:{media_type:'image/png',data:png},user_id:'another-user'}),res);
    assert.equal(res.code,200);
    const content=JSON.parse(calls[1].init.body).messages[0].content;
    assert.equal(content[0].source.data,png);
    assert.ok(content[1].text.includes(message));
    const saved=JSON.parse(calls[2].init.body);
    assert.equal(saved.user_id,'image-'+message);
    assert.equal(saved.was_photo,true);
    assert.equal(saved.snippet,'');
    assert.ok(!calls[2].init.body.includes(png));
    t.mock.restoreAll();
  }
});

test('invalid images and mislabeled files never reach auth or the paid provider',async t=>{
  const calls=mockFetch(t);
  for (const image of [null,[],true,'photo',{media_type:'image/svg+xml',data:png},{media_type:'image/png',data:'!!notbase64!!'},{media_type:'image/jpeg',data:png},{media_type:'image/png',data:''},{media_type:'image/png',data:Buffer.alloc(MAX_IMAGE_BYTES+1).toString('base64')}]) {
    const res=response(); await handler(request({message:'hello',image}),res);
    assert.equal(res.code,400);
  }
  assert.equal(calls.length,0);
});

test('request size is measured in bytes and checked before parsing or provider access',async t=>{
  const calls=mockFetch(t),res=response();
  await handler(request({message:'\u00e9'.repeat(Math.ceil(MAX_CHECK_BYTES/2))}),res);
  assert.equal(res.code,413); assert.equal(calls.length,0);
});

test('a history error preserves the assessment without falsely claiming it was saved',async t=>{
  process.env.ANTHROPIC_API_KEY='test-placeholder';
  t.after(()=>delete process.env.ANTHROPIC_API_KEY);
  for (const options of [{saveError:true},{saveThrows:true}]) {
    mockFetch(t,options); const res=response();
    await handler(request(),res);
    assert.equal(res.code,200);
    assert.equal(res.body.historySaved,false);
    assert.equal(res.body.result.verdict,'caution');
    assert.ok(!JSON.stringify(res.body).includes('private database'));
    t.mock.restoreAll();
  }
});
