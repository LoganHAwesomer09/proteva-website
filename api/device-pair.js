import { prepare, readBody, authorize, withinRateLimit } from '../lib/server.js';
import { deviceStore, newToken, tokenHash, validId } from '../lib/device.js';

export default async function handler(req,res) {
  if (!prepare(req,res)) return;
  const body=readBody(req,res);
  if (!body) return;
  const user=await authorize(req,res);
  if (!user || !withinRateLimit(user.id,res)) return;
  const store=deviceStore();
  if (!store) return res.status(503).json({error:'Device enrollment is not available.'});

  if (body.action==='revoke' && validId(body.installationId)) {
    const {data,error}=await store.from('device_installations').update({revoked_at:new Date().toISOString()})
      .eq('id',body.installationId).eq('user_id',user.id).is('revoked_at',null).select('id').single();
    if (error || !data) return res.status(404).json({error:'Device enrollment not found.'});
    return res.status(200).json({revoked:true});
  }
  if (body.action!=='create' || !validId(body.personId)) return res.status(400).json({error:'Choose a valid family member.'});
  const {data:person,error:personError}=await store.from('protected_people').select('id').eq('id',body.personId).eq('user_id',user.id).single();
  if (personError || !person) return res.status(404).json({error:'Family member not found.'});
  const token=newToken();
  const {data,error}=await store.from('device_installations').insert({user_id:user.id,person_id:person.id,token_hash:tokenHash(token)}).select('id').single();
  if (error || !data) return res.status(503).json({error:'Could not enroll the device. Please try again.'});
  // This credential is returned once; the database stores only its hash.
  return res.status(201).json({installationId:data.id,deviceToken:token});
}
