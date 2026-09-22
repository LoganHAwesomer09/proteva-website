import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../assets/config.js';

const windows = new Map();
export function prepare(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method!=='POST') { res.setHeader('Allow','POST'); res.status(405).json({error:'Method not allowed.'}); return false; }
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { res.status(415).json({error:'Send a JSON request.'}); return false; }
  return true;
}
export function readBody(req,res) {
  try {
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if (!body || typeof body!=='object' || Array.isArray(body) || JSON.stringify(body).length>16000) throw new Error('Invalid body');
    return body;
  } catch { res.status(400).json({error:'Please send a valid request.'}); return null; }
}
export async function authorize(req,res) {
  const authorization=req.headers.authorization || '';
  if (!/^Bearer \S+$/i.test(authorization) || authorization.length>8192) { res.status(401).json({error:'Please sign in to continue.'}); return null; }
  try {
    const client=createClient(process.env.SUPABASE_URL || SUPABASE_URL,process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(8000)})}
    });
    const {data,error}=await client.auth.getUser(authorization.slice(7));
    if (error || !data.user?.id || data.user.is_anonymous) { res.status(401).json({error:'Please sign in again.'}); return null; }
    return data.user;
  } catch { res.status(503).json({error:'We could not verify your session. Please try again.'}); return null; }
}
// This bounds bursts per warm function instance; production-wide limits belong in the gateway.
export function withinRateLimit(userId,res,now=Date.now()) {
  for (const [id,record] of windows) if (record.until<=now) windows.delete(id);
  let record=windows.get(userId);
  if (!record) {
    if (windows.size>=2000) { res.setHeader('Retry-After','60'); res.status(429).json({error:'Please wait a minute and try again.'}); return false; }
    record={count:0,until:now+60000}; windows.set(userId,record);
  }
  if (record.count>=10) { res.setHeader('Retry-After',String(Math.max(1,Math.ceil((record.until-now)/1000)))); res.status(429).json({error:'Please wait a minute and try again.'}); return false; }
  record.count++; return true;
}
export function parseAssessment(text) {
  const cleaned=String(text || '').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const value=JSON.parse(cleaned);
  if (!value || !['danger','caution','safe'].includes(value.verdict) || !['headline','why','whatToDo'].every(key=>typeof value[key]==='string' && value[key].trim().length>0 && value[key].length<=2000)) throw new Error('Invalid assessment');
  return {verdict:value.verdict,headline:value.headline.trim(),why:value.why.trim(),whatToDo:value.whatToDo.trim()};
}
