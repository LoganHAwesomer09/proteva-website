import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { build } from './build.mjs';
import { MAX_CHECK_BYTES } from '../assets/checker-limits.js';
const output=await build();
const port=Number(process.env.PORT || 4173);
const deployment=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
const handlers={
  '/api/check-scam':(await import('../api/check-scam.js')).default,
  '/api/generate-threat':(await import('../api/generate-threat.js')).default
};
http.createServer(async(req,res)=>{
  for (const header of deployment.headers[0].headers) res.setHeader(header.key,header.value);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try {
    const url=new URL(req.url,'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const handler=handlers[url.pathname];
      if (!handler) { res.writeHead(404).end(); return; }
      const chunks=[];
      let bytes=0;
      const limit=url.pathname==='/api/check-scam'?MAX_CHECK_BYTES:16000;
      for await (const chunk of req) {
        bytes+=chunk.length;
        if (bytes>limit) { res.writeHead(413,{'Content-Type':'application/json'}).end(JSON.stringify({error:'This request is too large.'})); return; }
        chunks.push(chunk);
      }
      req.body=Buffer.concat(chunks).toString('utf8');
      res.status=code=>{res.statusCode=code;return res;};
      res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
      await handler(req,res); return;
    }
    const relative=decodeURIComponent(url.pathname)==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/,'');
    const file=path.resolve(output,relative);
    if (!file.startsWith(output+path.sep) || !(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
}).listen(port,'127.0.0.1',()=>console.log('Proteva preview: http://127.0.0.1:'+port));
