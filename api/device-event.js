import { prepare, readBody, withinRateLimit } from '../lib/server.js';
import { deviceStore, eventDescriptions, tokenHash, validId } from '../lib/device.js';

export default async function handler(req,res) {
  if (!prepare(req,res)) return;
  const body=readBody(req,res);
  if (!body) return;
  if (JSON.stringify(body).length>1000 || !validId(body.eventId) || !Object.hasOwn(eventDescriptions,body.type) || Object.keys(body).some(key=>!['eventId','type'].includes(key)))
    return res.status(400).json({error:'Invalid device event.'});
  const authorization=req.headers.authorization || '';
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) return res.status(401).json({error:'Device enrollment required.'});
  const store=deviceStore();
  if (!store) return res.status(503).json({error:'Device events are not available.'});
  const hash=tokenHash(authorization.slice(7));
  if (!withinRateLimit('device:'+hash,res)) return;
  const {data:installation,error:lookupError}=await store.from('device_installations').select('id,user_id,person_id,revoked_at').eq('token_hash',hash).single();
  if (lookupError || !installation || installation.revoked_at) return res.status(401).json({error:'Device enrollment required.'});
  const {error}=await store.from('activity').insert({user_id:installation.user_id,person_id:installation.person_id,
    device_installation_id:installation.id,device_event_id:body.eventId,resolved:false,...eventDescriptions[body.type]});
  if (error?.code==='23505') return res.status(200).json({recorded:true,duplicate:true});
  if (error) return res.status(503).json({error:'Could not record this event. Please try again.'});
  return res.status(201).json({recorded:true});
}
