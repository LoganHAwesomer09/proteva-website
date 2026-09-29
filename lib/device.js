import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '../assets/config.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validId=value=>typeof value==='string' && uuid.test(value);
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export const newToken=()=>randomBytes(32).toString('base64url');

export function deviceStore() {
  if (process.env.DEVICE_INGEST_ENABLED!=='true') return null;
  const key=process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.SUPABASE_URL || SUPABASE_URL,key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(8000)})}
  });
}

// Only discrete device actions are accepted. Never receive URLs, messages,
// browsing history, or arbitrary device-provided text through this endpoint.
export const eventDescriptions={
  risky_site_blocked:{icon:'shield-check',text:'Blocked a risky website in Safari',tag:'stopped',detail_why:'The device matched a known risky website rule.',detail_did:'The device reports that Safari blocked the website from loading.',detail_actions:'No action is needed. Ask your loved one if they want help understanding what happened.'},
  risky_site_warning:{icon:'shield-alert',text:'A risky website needs a closer look',tag:'attention',detail_why:'The device flagged a website as potentially risky.',detail_did:'The device reports a warning. It did not confirm that the website was blocked.',detail_actions:'Talk with your loved one before opening the website or entering any information.'}
};
