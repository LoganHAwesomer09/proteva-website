import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, icons, message, busy } from './ui.js';
icons();
const form=$('waitlist-form');
if (form) form.addEventListener('submit',async event=>{
  event.preventDefault();
  if (form.getAttribute('aria-busy')==='true') return;
  message('waitlist-message');
  const email=$('waitlist-email').value.trim().toLowerCase();
  busy(form,true); $('join-btn').textContent='Joining...';
  try {
    if (!window.supabase) throw new Error('Unavailable');
    const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
    const {error}=await sb.from('waitlist').insert({email});
    if (error && error.code!=='23505') throw error;
    form.hidden=true;
    message('waitlist-message','You\u2019re on the list. We\u2019ll be in touch as Proteva takes shape.','success');
  } catch {
    message('waitlist-message','We couldn\u2019t add you just now. Please try again, or email hello@getproteva.com.');
  } finally { busy(form,false); $('join-btn').textContent='Join the waitlist'; }
});
