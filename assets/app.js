import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, escapeHtml as esc, icons, icon, message, busy, toast, initials, empty, loading, dateLabel, errorText } from './ui.js';

const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const state = { user: null, members: [], view: 'dashboard', person: null, epoch: 0, request: 0, signup: false, editing: null, deleting: null, limit: 20, onboardStep: 0, consent: false };
const views = ['dashboard','family','person','history','checker','settings','profile','help'];
const labels = {dashboard:'Overview',family:'Family',person:'Family member',history:'History',checker:'Scam checker',settings:'Settings',profile:'Your profile',help:'Help & support'};
const containers = {dashboard:'dashboard-content',family:'member-list',person:'person-content',history:'history-feed',profile:'profile-content'};
const pending = new Set();
let activeCounts = {};
let checkerController;
let checkerImage = null; // { media_type, data } for an attached photo, or null
const relationshipOptions = '<option value="">Choose a relationship</option>' + ['Mother','Father','Grandmother','Grandfather','Aunt','Uncle','Spouse','Sibling','Friend','Other'].map(x=>'<option>'+x+'</option>').join('');

function scoped(table) {
  if (!state.user) throw new Error('Please sign in.');
  return sb.from(table).select('*').eq('user_id', state.user.id);
}
async function result(query) {
  const value = await query;
  if (value.error) throw value.error;
  return value;
}
async function members() {
  const epoch = state.epoch, request = state.request, rows = [];
  for (let offset = 0; ; offset += 500) {
    const {data} = await result(scoped('protected_people').order('created_at').order('id').range(offset, offset + 499));
    if (epoch !== state.epoch) return [];
    rows.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  if (request === state.request) state.members = rows;
  return rows;
}
async function memberCounts() {
  const epoch=state.epoch, request=state.request, counts={};
  for(let offset=0;;offset+=500) {
    const {data}=await result(sb.from('activity').select('person_id').eq('user_id',state.user.id).eq('resolved',false).order('id').range(offset,offset+499));
    if (epoch!==state.epoch) return;
    for(const row of data || []) if(row.person_id) counts[row.person_id]=(counts[row.person_id] || 0)+1;
    if (!data || data.length<500) break;
  }
  if(request===state.request) activeCounts=counts;
}
async function countActivity(tag, since, unresolved = false) {
  let query = sb.from('activity').select('id', {count:'exact', head:true}).eq('user_id',state.user.id);
  if (tag) query = query.eq('tag',tag);
  if (since) query = query.gte('created_at',since);
  if (unresolved) query = query.eq('resolved',false);
  const {count} = await result(query);
  return count ?? 0;
}
async function activity(archived, person) {
  let query = scoped('activity').eq('resolved',archived);
  if (person) query = query.eq('person_id',person);
  const {data} = await result(query.order('created_at',{ascending:false}).order('id',{ascending:false}).range(0,state.limit));
  return {rows:(data || []).slice(0,state.limit), more:(data || []).length > state.limit};
}
function moreButton(more) { return more ? '<button class="btn btn-secondary" data-action="more">Load more activity</button>' : ''; }
function memberHtml(person, compact = false) {
  const details = [person.relationship, person.devices || person.device].filter(Boolean).join(' \u00b7 ') || 'Device setup pending';
  return '<div class="member"><button class="member-main" data-person="'+esc(person.id)+'"><span class="avatar">'+esc(initials(person.name))+'</span><span class="member-info"><strong>'+esc(person.name)+'</strong><small>'+esc(details)+'</small></span></button>' +
    (compact ? icon('chevron-right') : (activeCounts[person.id]?'<span class="pill attention">'+activeCounts[person.id]+' active</span>':'<span class="pill neutral">Setup pending</span>')+'<div class="member-actions"><button class="icon-btn" data-edit="'+esc(person.id)+'" aria-label="Edit '+esc(person.name)+'" title="Edit member">'+icon('pencil')+'</button><button class="icon-btn danger" data-delete="'+esc(person.id)+'" aria-label="Remove '+esc(person.name)+'" title="Remove member">'+icon('trash-2')+'</button></div>')+'</div>';
}
function feedItem(item, archived = false) {
  const person = state.members.find(p=>p.id===item.person_id);
  const details = [['What happened',item.detail_why],['What Proteva did',item.detail_did],['What you can do',item.detail_actions]].filter(([,text])=>text);
  const status = archived ? 'Archived' : item.tag==='stopped' ? 'Handled' : 'Your input';
  const tagClass = archived ? 'neutral' : item.tag==='stopped' ? '' : 'attention';
  return '<article class="feed-item"><div class="feed-row"><span class="event-icon">'+icon(item.tag==='stopped'?'shield-check':'message-circle')+'</span><div class="feed-body"><p class="feed-text">'+esc(item.text)+'</p><p class="feed-meta">'+esc(person?.name || 'Family activity')+' \u00b7 '+esc(dateLabel(item.created_at,archived))+'</p><div class="feed-status"><span class="pill '+tagClass+'">'+status+'</span></div>' +
    (details.length ? '<details><summary>See details</summary><div class="detail">'+details.map(([title,text])=>'<h3>'+title+'</h3><p>'+esc(text)+'</p>').join('')+'</div></details>' : '') +
    '</div>'+(archived?'':'<button class="icon-btn" data-archive="'+esc(item.id)+'" aria-label="Archive '+esc(item.text)+'" title="Archive to history">'+icon('x')+'</button>')+'</div></article>';
}
function historyHtml(rows) {
  if (!rows.length) return empty('Nothing archived yet', 'Items you archive will be kept here, organized by date.');
  const groups = new Map();
  for (const row of rows) {
    const day = dateLabel(row.created_at);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(row);
  }
  return [...groups].map(([day, items])=>'<h2 class="date-header">'+esc(day)+'</h2><div class="feed">'+items.map(item=>feedItem(item,true)).join('')+'</div>').join('');
}
function memberEmpty() {
  return empty('A place for the people you love', 'Add your first family member when you are ready to set up together.', '<button class="btn btn-primary" data-action="add-member">'+icon('plus')+'Add family member</button>');
}
async function dashboardHtml() {
  const since = new Date(Date.now() - 7*86400000).toISOString();
  const [people, stopped, attention, week, active] = await Promise.all([members(),countActivity('stopped'),countActivity('attention',null,true),countActivity('stopped',since),activity(false)]);
  return '<div class="banner '+(attention?'attention':'')+'">'+icon(attention?'message-circle':'shield-check')+'<div><h2>'+(attention?attention+' item'+(attention===1?' needs':'s need')+' a conversation':people.length?'Your family space is up to date':'Let\u2019s start with someone you love')+'</h2><p>'+(attention?'See the suggested next steps below.':'No outstanding requests for your input.')+'</p></div></div>'+
    '<div class="stats"><div class="stat"><div class="stat-top">Threats stopped'+icon('shield-check')+'</div><strong id="stat-stopped">'+stopped+'</strong><small>all recorded activity</small></div><div class="stat"><div class="stat-top">Family members'+icon('users')+'</div><strong id="stat-people">'+people.length+'</strong><small>device setup pending</small></div><div class="stat"><div class="stat-top">Needs your input'+icon('message-circle')+'</div><strong id="stat-attention">'+attention+'</strong><small>open items</small></div></div>'+
    '<div class="dashboard-columns"><div><div class="section-head"><h2>What Proteva caught &amp; handled</h2></div>'+(active.rows.length?'<div class="feed">'+active.rows.map(item=>feedItem(item)).join('')+'</div>'+moreButton(active.more):empty('Nothing needs your attention','New activity will appear here. No device monitoring is active in this preview.'))+'</div><aside><div class="section-head"><h2>Your family</h2><button class="icon-btn" data-action="add-member" aria-label="Add family member" title="Add family member">'+icon('plus')+'</button></div>'+(people.length?people.slice(0,5).map(p=>memberHtml(p,true)).join('')+'<button class="btn btn-quiet full" data-view="family">View family'+icon('arrow-right')+'</button>':memberEmpty())+'<section class="digest"><p class="eyebrow">The last 7 days</p><h3>'+week+' recorded stop'+(week===1?'':'s')+'</h3><p>Includes archived activity. Sample events demonstrate how prevention will appear here.</p></section></aside></div>'+
    '<div class="demo-actions"><p>Get a feel for a calmer kind of protection.</p><button class="btn btn-quiet" data-action="simulate">'+icon('flask-conical')+'Explore a sample event</button></div>';
}
async function familyHtml() {
  const [people] = await Promise.all([members(),memberCounts()]);
  return people.length ? people.map(p=>memberHtml(p)).join('') : memberEmpty();
}
async function personHtml() {
  const id = state.person;
  const [people, active, history] = await Promise.all([members(),activity(false,id),activity(true,id)]);
  const person = people.find(p=>p.id===id);
  if (!person) return empty('This profile is no longer available', 'Return to Family to see your current profiles.');
  const meta = [person.relationship, person.devices || person.device, person.birth_year ? 'Born '+person.birth_year : null].filter(Boolean).join(' \u00b7 ');
  return '<header class="person-header"><span class="avatar">'+esc(initials(person.name))+'</span><div><h1 tabindex="-1">'+esc(person.name)+'</h1><p class="muted">'+esc(meta)+'</p><span class="pill neutral">Device setup pending</span></div><button class="btn btn-secondary" data-edit="'+esc(id)+'">'+icon('pencil')+'Edit details</button></header>'+
    (person.notes?'<p class="person-notes">'+esc(person.notes)+'</p>':'')+
    '<div class="section-head"><h2>Current activity</h2></div>'+(active.rows.length?'<div class="feed">'+active.rows.map(item=>feedItem(item)).join('')+'</div>':empty('No open items','Nothing needs your input for this person.'))+
    '<h2 class="date-header">Archived activity</h2>'+historyHtml(history.rows)+moreButton(active.more||history.more);
}
async function profileHtml() {
  const people = await members();
  return '<section class="settings-section"><div><span class="avatar">'+esc(initials(state.user.email))+'</span><h2>Caregiver account</h2></div><dl><div class="kv"><dt>Email</dt><dd>'+esc(state.user.email)+'</dd></div><div class="kv"><dt>Family members</dt><dd>'+people.length+'</dd></div><div class="kv"><dt>Member since</dt><dd>'+esc(dateLabel(state.user.created_at))+'</dd></div></dl></section>';
}
async function loadView() {
  if (!state.user) return;
  const view = state.view, request = ++state.request, epoch = state.epoch;
  const target = $(containers[view]);
  if (!target) return;
  target.innerHTML = loading();
  try {
    let html;
    if (view==='dashboard') html = await dashboardHtml();
    if (view==='family') html = await familyHtml();
    if (view==='person') html = await personHtml();
    if (view==='profile') html = await profileHtml();
    if (view==='history') { const [, records] = await Promise.all([members(),activity(true)]); html=historyHtml(records.rows)+moreButton(records.more); }
    if (request!==state.request || epoch!==state.epoch) return;
    target.innerHTML = html;
  } catch (error) {
    if (request!==state.request || epoch!==state.epoch) return;
    target.innerHTML = empty('We couldn\u2019t load this right now',errorText(error,'Your saved data is unchanged. Check your connection and try again.'),'<button class="btn btn-secondary" data-action="retry">'+icon('refresh-cw')+'Try again</button>');
  }
  icons();
}
async function navigate(view, {focus = true, reset = true} = {}) {
  if (!views.includes(view) || !state.user) return;
  state.view = view;
  if (reset) state.limit = 20;
  for (const name of views) $('view-'+name).hidden = name!==view;
  document.querySelectorAll('.nav-item').forEach(button=>{
    if (button.dataset.view===(view==='person'?'family':view)) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  $('breadcrumb').textContent='Your family / '+labels[view];
  document.title=labels[view]+' | Proteva';
  closeMenu(); setMobile(false);
  if (focus) document.querySelector('#view-'+view+' h1')?.focus();
  await loadView();
}
function closeMenu() { $('account-menu').hidden=true; $('account-btn').setAttribute('aria-expanded','false'); }
function setMobile(open) {
  $('sidebar').classList.toggle('open',open);
  $('mobile-menu').setAttribute('aria-expanded',String(open));
  $('sidebar').inert=matchMedia('(max-width:800px)').matches&&!open;
}
function showDialog(id) { $(id).showModal(); icons(); }
function closeDialog(id) {
  if ($(id).getAttribute('aria-busy')==='true' || $(id).querySelector('[aria-busy="true"]')) return;
  $(id).close();
}
function clearSession() {
  state.epoch++; state.request++; state.user=null; state.members=[]; state.person=null; state.editing=null; state.deleting=null; state.consent=false;
  checkerController?.abort();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  for (const id of Object.values(containers)) $(id).replaceChildren();
  $('checker-result').replaceChildren(); $('checker-input').value=''; $('checker-count').textContent='0 / 4,000 characters'; clearCheckerImage();
  for (const id of ['auth-form','member-form','password-form']) $(id).reset();
  for (const id of ['account-email','settings-email','user-initial']) $(id).textContent='';
  $('onboarding-content').replaceChildren(); $('delete-description').textContent='';
  onboardDraft={name:'',relationship:'',devices:''}; activeCounts={};
  $('app-shell').hidden=true; $('auth-screen').hidden=false;
  closeMenu(); setMobile(false); message('auth-message');
}
async function enterApp(user, recovery = false) {
  if (state.user?.id===user.id && !recovery) return;
  if (state.user) clearSession();
  state.user=user; const epoch=++state.epoch;
  $('auth-screen').hidden=true; $('app-shell').hidden=false;
  $('account-email').textContent=user.email || 'Your account';
  $('settings-email').textContent=user.email || '';
  $('user-initial').textContent=initials(user.email);
  $('password').value='';
  await navigate(recovery?'settings':'dashboard',{focus:false});
  if (epoch!==state.epoch) return;
  if (recovery) { message('password-message','Choose your new password below.','success'); $('new-password').focus(); return; }
  try {
    const {count} = await result(sb.from('protected_people').select('id',{count:'exact',head:true}).eq('user_id',user.id));
    let done=false; try { done=localStorage.getItem('proteva_onboarded:'+user.id)==='1'; } catch { /* Optional local preference. */ }
    if (!done && count===0 && epoch===state.epoch) startOnboarding();
  } catch { /* A failed read must never be treated as an empty account. */ }
}
async function handleAuth(event) {
  event.preventDefault();
  const form=event.currentTarget;
  if (form.getAttribute('aria-busy')==='true') return;
  message('auth-message');
  if (!sb) return message('auth-message','Proteva could not start. Please refresh this page.');
  busy(form,true);
  const signup=state.signup;
  $('auth-btn').textContent=signup?'Creating account...':'Signing in...';
  try {
    const credentials={email:$('email').value.trim(),password:$('password').value};
    const {data,error}=await (signup?sb.auth.signUp(credentials):sb.auth.signInWithPassword(credentials));
    if (error) throw error;
    if (data.session) await enterApp(data.session.user);
    else { setAuthMode(false); message('auth-message','Check your email for a confirmation link, then come back to sign in.','success'); }
  } catch {
    message('auth-message',signup?'We couldn\u2019t create your account. Please check your details or try signing in.':'We couldn\u2019t sign you in. Check your email and password, or try again in a moment.');
  } finally { busy(form,false); $('auth-btn').textContent=state.signup?'Create account':'Sign in'; }
}
function setAuthMode(signup) {
  state.signup=signup; message('auth-message');
  $('auth-title').textContent=signup?'A little more peace of mind':'Welcome back';
  $('auth-subtitle').textContent=signup?'Create your caregiver account. Set up together.':'A little peace of mind, all in one place.';
  $('auth-btn').textContent=signup?'Create account':'Sign in';
  $('auth-toggle-label').textContent=signup?'Already have an account?':'New to Proteva?';
  $('auth-toggle').textContent=signup?'Sign in':'Create an account';
  $('forgot-password').hidden=signup;
  $('password').autocomplete=signup?'new-password':'current-password';
  $('password').minLength=signup?8:6;
}

async function logout() {
  if (pending.has('logout')) return;
  pending.add('logout');
  try {
    const {error}=await sb.auth.signOut({scope:'local'});
    if (error) throw error;
    clearSession(); setAuthMode(false);
    message('auth-message','You have been signed out.','success');
  } catch { toast('We couldn\u2019t sign out. Please try again.'); }
  finally { pending.delete('logout'); }
}
async function forgotPassword() {
  const email=$('email');
  if (!email.reportValidity()) return;
  if (pending.has('reset')) return;
  pending.add('reset'); $('forgot-password').disabled=true;
  try {
    const {error}=await sb.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:location.origin+'/app.html'});
    if (error) throw error;
    message('auth-message','If an account exists for this email, you\u2019ll receive a password reset link.','success');
  } catch { message('auth-message','We couldn\u2019t send a reset email. Please try again later.'); }
  finally { pending.delete('reset'); $('forgot-password').disabled=false; }
}
async function changePassword(event) {
  event.preventDefault();
  const form=event.currentTarget, epoch=state.epoch;
  if (form.getAttribute('aria-busy')==='true') return;
  message('password-message');
  if ($('new-password').value!==$('confirm-password').value) return message('password-message','The passwords don\u2019t match. Please check them and try again.');
  busy(form,true);
  try {
    const {error}=await sb.auth.updateUser({password:$('new-password').value});
    if (error) throw error;
    if (epoch===state.epoch) { form.reset(); message('password-message','Your password has been updated.','success'); }
  } catch { if (epoch===state.epoch) message('password-message','We couldn\u2019t update your password. Try again, or request a new reset link from sign-in.'); }
  finally { busy(form,false); }
}
function openMember(id = null) {
  const person=id?state.members.find(p=>p.id===id):null;
  if (id && !person) return;
  state.editing=id; $('member-form').reset(); message('member-message');
  $('member-title').textContent=id?'Edit family member':'Add a family member';
  $('save-member-btn').textContent=id?'Save changes':'Add family member';
  $('member-name').value=person?.name || '';
  const relationship=person?.relationship || '';
  const predefined=Array.from($('member-relationship').options).some(o=>o.value===relationship);
  $('member-relationship').value=predefined?relationship:'Other';
  $('member-other').value=predefined?'':relationship;
  updateRelationship();
  $('member-devices').value=person?.devices || person?.device || '';
  $('member-birthyear').value=person?.birth_year || '';
  $('member-protection').value=person?.protection_level || 'standard';
  $('member-notes').value=person?.notes || '';
  showDialog('member-dialog');
}
function updateRelationship() {
  const other=$('member-relationship').value==='Other';
  $('relationship-other-field').hidden=!other;
  $('member-other').required=other;
}
async function saveMember(event) {
  event.preventDefault();
  const form=event.currentTarget, id=state.editing, epoch=state.epoch;
  if (form.getAttribute('aria-busy')==='true') return;
  message('member-message');
  const name=$('member-name').value.trim();
  if (!name) return message('member-message','Please enter their name.');
  const raw=$('member-birthyear').value, birthYear=raw?Number(raw):null;
  if (birthYear!==null && (!Number.isInteger(birthYear)||birthYear<1900||birthYear>new Date().getFullYear())) return message('member-message','Please enter a whole birth year between 1900 and this year.');
  const relationship=$('member-relationship').value==='Other'?$('member-other').value.trim():$('member-relationship').value;
  if ($('member-relationship').value==='Other'&&!relationship) return message('member-message','Please describe your relationship.');
  const payload={name,relationship:relationship||null,devices:$('member-devices').value.trim()||null,birth_year:birthYear,protection_level:$('member-protection').value,notes:$('member-notes').value.trim()||null};
  busy(form,true);
  try {
    const query=id?sb.from('protected_people').update(payload).eq('id',id).eq('user_id',state.user.id):sb.from('protected_people').insert({...payload,user_id:state.user.id});
    const {data}=await result(query.select('id'));
    if (!data?.length) throw new Error('No row saved');
    if (epoch!==state.epoch) return;
    $('member-dialog').close(); toast(id?'Family details updated.':'Family member added. Device setup is still pending.');
    await loadView();
  } catch(error) { if (epoch===state.epoch) message('member-message',errorText(error,'We couldn\u2019t save those details. Your changes are still here; please try again.')); }
  finally { busy(form,false); }
}
function confirmDelete(id) {
  const person=state.members.find(p=>p.id===id);
  if (!person) return;
  state.deleting=id;
  $('delete-description').textContent='Remove '+person.name+' and all of their recorded activity? This cannot be undone. It does not uninstall anything from their device.';
  message('delete-message'); showDialog('delete-dialog');
}
async function deleteMember() {
  const id=state.deleting, epoch=state.epoch;
  if (!id || pending.has('delete')) return;
  pending.add('delete'); busy($('delete-dialog'),true);
  try {
    const {data}=await result(sb.from('protected_people').delete().eq('id',id).eq('user_id',state.user.id).select('id'));
    if (!data?.length) throw new Error('No row removed');
    if (epoch!==state.epoch) return;
    $('delete-dialog').close(); toast('Family member and their activity removed.');
    if (state.view==='person'&&state.person===id) await navigate('family'); else await loadView();
  } catch { if (epoch===state.epoch) message('delete-message','We couldn\u2019t remove this person. Please try again.'); }
  finally { pending.delete('delete'); busy($('delete-dialog'),false); }
}
async function archive(id, button) {
  if (pending.has(id)) return;
  const epoch=state.epoch;
  pending.add(id); button.disabled=true;
  try {
    const {data}=await result(sb.from('activity').update({resolved:true}).eq('id',id).eq('user_id',state.user.id).select('id'));
    if (!data?.length) throw new Error('No row archived');
    if (epoch!==state.epoch) return;
    toast('Moved to History. The recorded assessment is unchanged.');
    await loadView();
  } catch { if (epoch===state.epoch) toast('We couldn\u2019t archive that item. It is still in your activity.'); }
  finally { pending.delete(id); button.disabled=false; }
}
async function openSimulation() {
  const epoch=state.epoch;
  try {
    await members();
    if (epoch!==state.epoch) return;
    if (!state.members.length) { await navigate('family'); openMember(); return; }
    $('simulation-person').innerHTML=state.members.map(person=>'<option value="'+esc(person.id)+'">'+esc(person.name)+'</option>').join('');
    message('simulation-message'); showDialog('simulation-dialog');
  } catch { toast('We couldn\u2019t load your family. Please try again.'); }
}
const samples=[
  {icon:'shield-check',text:'Sample: blocked a fake support pop-up',tag:'stopped',detail_why:'A fake support message tried to persuade someone to call an unfamiliar number.',detail_did:'In this sample, Proteva would block the page and prevent the pop-up from reopening.',detail_actions:'No action is needed for this demonstration. Real support teams do not ask for payment through alarming pop-ups.'},
  {icon:'shield-check',text:'Sample: stopped a suspicious banking link',tag:'stopped',detail_why:'A message used urgency to direct someone to a look-alike banking website.',detail_did:'In this sample, Proteva would stop the unsafe page from opening.',detail_actions:'Open the bank app yourself or call the number on the bank card. Do not use contact details from the message.'},
  {icon:'message-circle',text:'Sample: an unfamiliar app needs a conversation',tag:'attention',detail_why:'An unfamiliar app requested permissions that did not match its purpose.',detail_did:'In this sample, Proteva would pause the app and explain the concern.',detail_actions:'Call your loved one and ask what they were trying to do. Help them find a trusted way to do it; you do not need to assess the app yourself.'}
];
async function simulate(event) {
  event.preventDefault();
  const form=event.currentTarget, epoch=state.epoch;
  if (form.getAttribute('aria-busy')==='true') return;
  const id=$('simulation-person').value;
  if (!state.members.some(p=>p.id===id)) return;
  busy(form,true); message('simulation-message');
  try {
    await result(sb.from('activity').insert({...samples[Math.floor(Math.random()*samples.length)],person_id:id,user_id:state.user.id,resolved:false}));
    if (epoch!==state.epoch) return;
    $('simulation-dialog').close(); toast('Sample event added. No device action was taken.');
    await loadView();
  } catch { if (epoch===state.epoch) message('simulation-message','We couldn\u2019t save the sample. Please try again.'); }
  finally { busy(form,false); }
}
let onboardDraft={name:'',relationship:'',devices:''};
function startOnboarding() {
  state.onboardStep=0; state.consent=false; onboardDraft={name:'',relationship:'',devices:''};
  renderOnboarding(); showDialog('onboarding-dialog');
}
function captureOnboarding() {
  if ($('ob-name')) onboardDraft={name:$('ob-name').value,relationship:$('ob-relationship').value,devices:$('ob-devices').value};
}
function renderOnboarding() {
  const step=state.onboardStep;
  $('onboarding-step-label').textContent='Step '+(step+1)+' of 4';
  document.querySelectorAll('.ob-progress span').forEach((el,i)=>el.classList.toggle('active',i<=step));
  const next='<button class="btn btn-primary" data-action="ob-next">Continue'+icon('arrow-right')+'</button>';
  const back='<button class="btn btn-secondary" data-action="ob-back">'+icon('arrow-left')+'Back</button>';
  let content='';
  if (step===0) content=icon('heart-handshake')+'<h2 id="onboarding-title" tabindex="-1">Welcome to your family space</h2><p>You\u2019re here because someone matters to you. We\u2019re glad you\u2019re here, too.</p><p>Let\u2019s create a profile together. This preview does not install software or start device protection.</p><div class="dialog-actions">'+next+'</div>';
  if (step===1) content=icon('hand-heart')+'<h2 id="onboarding-title" tabindex="-1">With them. Never behind their back.</h2><p>Your loved one deserves to understand what Proteva does and to choose it for themselves.</p><label class="consent"><input type="checkbox" id="ob-consent" '+(state.consent?'checked':'')+'><span>I\u2019ll involve my loved one and get their agreement before setting up device protection.</span></label><div id="ob-consent-message" class="message" role="alert" hidden></div><div class="dialog-actions">'+back+next+'</div>';
  if (step===2) content='<h2 id="onboarding-title" tabindex="-1">Who are you looking out for?</h2><p>A few details now. You can add more later.</p><form id="onboarding-form"><div id="ob-message" class="message" role="alert" hidden></div><div class="field"><label for="ob-name">Their name</label><input id="ob-name" value="'+esc(onboardDraft.name)+'" required maxlength="100" placeholder="e.g. Rose"></div><div class="field"><label for="ob-relationship">Relationship <span class="optional">(optional)</span></label><select id="ob-relationship">'+relationshipOptions+'</select></div><div class="field"><label for="ob-devices">Devices <span class="optional">(optional)</span></label><input id="ob-devices" value="'+esc(onboardDraft.devices)+'" maxlength="160" placeholder="e.g. iPhone, iPad"></div><div class="dialog-actions"><button type="button" class="btn btn-secondary" data-action="ob-back">Back</button><button class="btn btn-primary" type="submit">Add &amp; continue</button></div></form>';
  if (step===3) content=icon('circle-check')+'<h2 id="onboarding-title" tabindex="-1">A thoughtful first step</h2><p>'+esc(onboardDraft.name)+'\u2019s profile is ready. Device protection is not active yet.</p><p>You can now explore the dashboard and see how Proteva will keep important information clear and calm.</p><div class="dialog-actions"><button class="btn btn-primary" data-action="ob-finish">Go to my dashboard</button></div>';
  $('onboarding-content').innerHTML='<div class="ob-step">'+content+(step<3?'<button class="btn btn-quiet full" data-action="ob-skip">I\u2019ll finish later</button>':'')+'</div>';
  if ($('ob-relationship')) $('ob-relationship').value=onboardDraft.relationship;
  icons(); $('onboarding-title').focus();
}
async function onboardAdd(event) {
  event.preventDefault(); captureOnboarding();
  const form=event.target, epoch=state.epoch;
  if (form.getAttribute('aria-busy')==='true') return;
  const name=onboardDraft.name.trim();
  if (!name) return message('ob-message','Please enter their name.');
  busy(form,true); $('onboarding-dialog').dataset.saving='true';
  try {
    await result(sb.from('protected_people').insert({user_id:state.user.id,name,relationship:onboardDraft.relationship||null,devices:onboardDraft.devices.trim()||null,protection_level:'standard'}));
    if (epoch!==state.epoch) return;
    onboardDraft.name=name; state.onboardStep=3; renderOnboarding();
  } catch(error) { if (epoch===state.epoch) message('ob-message',errorText(error,'We couldn\u2019t add this person. Your details are still here; please try again.')); }
  finally { busy(form,false); delete $('onboarding-dialog').dataset.saving; }
}
async function finishOnboarding() {
  if ($('onboarding-dialog').dataset.saving==='true') return;
  try { localStorage.setItem('proteva_onboarded:'+state.user.id,'1'); } catch { /* Optional local preference. */ }
  $('onboarding-dialog').close();
  await navigate('dashboard');
}
async function checkScam(event) {
  event.preventDefault();
  const form=event.currentTarget, epoch=state.epoch;
  if (form.getAttribute('aria-busy')==='true') return;
  const input=$('checker-input').value.trim();
  // Allow submitting with text, an image, or both. Block only if neither is present.
  if ((input.length<3 || input.length>4000) && !checkerImage) return;
  busy(form,true); $('checker-thinking').hidden=false; $('checker-result').replaceChildren();
  checkerController=new AbortController();
  const timeout=setTimeout(()=>checkerController?.abort(),35000);
  try {
    const {data,error}=await sb.auth.getSession();
    if (error || !data.session) throw new Error('Please sign in again to check a message.');
    const response=await fetch('/api/check-scam',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(checkerImage?{message:input,image:checkerImage}:{message:input}),signal:checkerController.signal});
    const parsed=await response.json();
    if (!response.ok) throw new Error(response.status===429?'You\u2019ve made several checks. Please wait a minute and try again.':response.status===401?'Please sign in again to check a message.':'The checker is unavailable right now. Please try again in a moment.');
    if (epoch!==state.epoch) return;
    const r=parsed.result;
    if (!r || !['danger','caution','safe'].includes(r.verdict) || !['headline','why','whatToDo'].every(k=>typeof r[k]==='string')) throw new Error('We couldn\u2019t read the result. Please try again.');
    $('checker-result').innerHTML='<div class="verdict '+r.verdict+'"><h2>'+esc(r.verdict==='safe'?'No obvious warning signs':r.headline)+'</h2></div><section class="result-section"><h3>What we noticed</h3><p>'+esc(r.why)+'</p></section><section class="result-section"><h3>Your next step</h3><p>'+esc(r.whatToDo)+'</p></section>'+(r.verdict==='safe'?'<p class="help-text">This does not verify who sent the message or whether a link is safe. Confirm independently before sharing information or money.</p>':'');
    $('checker-result').focus(); clearCheckerImage();
  } catch(error) {
    if (epoch===state.epoch) $('checker-result').innerHTML='<div class="message error" role="alert"><strong>We couldn\u2019t check this message.</strong><p>'+esc(error.name==='AbortError'?'The check took too long. Please try again.':error.message)+'</p><p>Avoid links or payments until you can verify the request independently.</p></div>';
  } finally { clearTimeout(timeout); busy(form,false); $('checker-thinking').hidden=true; }
}
document.addEventListener('click', async event => {
  const button=event.target.closest('button');
  if (!button || button.disabled) return;
  try {
    if (button.dataset.view) await navigate(button.dataset.view);
    if (button.dataset.person) { state.person=button.dataset.person; await navigate('person'); }
    if (button.dataset.edit) openMember(button.dataset.edit);
    if (button.dataset.delete) confirmDelete(button.dataset.delete);
    if (button.dataset.archive) await archive(button.dataset.archive,button);
    if (button.dataset.close) closeDialog(button.dataset.close);
    if (button.dataset.password) {
      const input=$(button.dataset.password), show=input.type==='password';
      input.type=show?'text':'password';
      button.setAttribute('aria-label',show?'Hide password':'Show password');
      button.title=show?'Hide password':'Show password';
      button.innerHTML=icon(show?'eye-off':'eye'); icons();
    }
    switch(button.dataset.action) {
      case 'logout': await logout(); break;
      case 'add-member': openMember(); break;
      case 'retry': await loadView(); break;
      case 'more': state.limit+=20; await loadView(); break;
      case 'simulate': await openSimulation(); break;
      case 'ob-next':
        if (state.onboardStep===1) {
          state.consent=$('ob-consent').checked;
          if (!state.consent) { message('ob-consent-message','Please confirm that you will set up together.'); return; }
        }
        state.onboardStep++; renderOnboarding(); break;
      case 'ob-back': captureOnboarding(); state.onboardStep--; renderOnboarding(); break;
      case 'ob-finish':
      case 'ob-skip': await finishOnboarding(); break;
    }
  } catch { toast('Something interrupted that action. Please try again.'); }
});
$('auth-form').addEventListener('submit',handleAuth);
$('auth-toggle').addEventListener('click',()=>setAuthMode(!state.signup));
$('forgot-password').addEventListener('click',forgotPassword);
$('password-form').addEventListener('submit',changePassword);
$('member-form').addEventListener('submit',saveMember);
$('member-relationship').addEventListener('change',updateRelationship);
$('member-birthyear').max=String(new Date().getFullYear());
$('delete-confirm').addEventListener('click',deleteMember);
$('simulation-form').addEventListener('submit',simulate);
$('checker-form').addEventListener('submit',checkScam);
$('checker-input').addEventListener('input',()=>{ $('checker-count').textContent=$('checker-input').value.length.toLocaleString()+' / 4,000 characters'; });
// ---- Scam checker: photo attachment ----
function clearCheckerImage() {
  checkerImage=null;
  const inp=$('checker-photo-input'); if (inp) inp.value='';
  const prev=$('checker-photo-preview'); if (prev) { prev.replaceChildren(); prev.hidden=true; }
}
async function handleCheckerPhoto(event) {
  const file=event.target.files && event.target.files[0];
  if (!file) return;
  const okTypes=['image/jpeg','image/png','image/gif','image/webp'];
  const msg=$('checker-result');
  if (!okTypes.includes(file.type)) { msg.innerHTML='<div class="message error" role="alert"><strong>That file type isn\u2019t supported.</strong><p>Please choose a JPG, PNG, GIF, or WEBP image.</p></div>'; event.target.value=''; return; }
  if (file.size > 5*1024*1024) { msg.innerHTML='<div class="message error" role="alert"><strong>That image is a bit too large.</strong><p>Please choose an image under 5MB.</p></div>'; event.target.value=''; return; }
  const dataUrl=await new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=()=>reject(new Error('read failed')); r.readAsDataURL(file); }).catch(()=>null);
  if (!dataUrl || typeof dataUrl!=='string' || dataUrl.indexOf(',')===-1) { event.target.value=''; return; }
  checkerImage={ media_type:file.type, data:dataUrl.slice(dataUrl.indexOf(',')+1) };
  const prev=$('checker-photo-preview');
  if (prev) {
    prev.replaceChildren();
    const img=document.createElement('img'); img.src=dataUrl; img.alt='Selected image preview'; img.className='checker-thumb';
    const remove=document.createElement('button'); remove.type='button'; remove.className='btn btn-quiet'; remove.textContent='Remove photo'; remove.addEventListener('click',clearCheckerImage);
    prev.append(img,remove); prev.hidden=false;
  }
}
{
  const photoInput=$('checker-photo-input');
  const photoBtn=$('checker-photo-btn');
  if (photoInput) photoInput.addEventListener('change',handleCheckerPhoto);
  if (photoBtn && photoInput) photoBtn.addEventListener('click',()=>photoInput.click());
}

$('onboarding-dialog').addEventListener('submit',event=>{ if (event.target.id==='onboarding-form') onboardAdd(event); });
$('onboarding-dialog').addEventListener('cancel',event=>{ event.preventDefault(); finishOnboarding(); });
for (const dialog of document.querySelectorAll('dialog:not(#onboarding-dialog)')) {
  dialog.addEventListener('cancel',event=>{
    if (dialog.querySelector('[aria-busy="true"]') || (dialog.id==='delete-dialog'&&pending.has('delete'))) event.preventDefault();
  });
}
$('account-btn').addEventListener('click',event=>{
  event.stopPropagation();
  const open=$('account-menu').hidden;
  $('account-menu').hidden=!open; $('account-btn').setAttribute('aria-expanded',String(open));
  if (open) $('account-menu').querySelector('button').focus();
});
document.addEventListener('click',event=>{ if (!event.target.closest('#account-menu')&&!event.target.closest('#account-btn')) closeMenu(); });
$('mobile-menu').addEventListener('click',()=>{
  const open=!$('sidebar').classList.contains('open');
  setMobile(open);
  if (open) $('sidebar').querySelector('.nav-item').focus();
});
$('nav-backdrop').addEventListener('click',()=>{ setMobile(false); $('mobile-menu').focus(); });
document.addEventListener('keydown',event=>{
  if (event.key==='Escape') {
    if (!$('account-menu').hidden) { closeMenu(); $('account-btn').focus(); }
    if ($('sidebar').classList.contains('open')) { setMobile(false); $('mobile-menu').focus(); }
  }
  if (event.key==='Tab' && $('sidebar').classList.contains('open') && matchMedia('(max-width:800px)').matches) {
    const focusable=[...$('sidebar').querySelectorAll('a,button')];
    const first=focusable[0], last=focusable.at(-1);
    if (event.shiftKey&&document.activeElement===first) { last.focus(); event.preventDefault(); }
    if (!event.shiftKey&&document.activeElement===last) { first.focus(); event.preventDefault(); }
  }
});
$('theme-toggle').checked=document.documentElement.dataset.theme==='dark';
matchMedia('(max-width:800px)').addEventListener('change',()=>setMobile(false));
setMobile(false);
$('theme-toggle').addEventListener('change',()=>{
  const theme=$('theme-toggle').checked?'dark':'light';
  document.documentElement.dataset.theme=theme;
  try { localStorage.setItem('proteva_theme',theme); } catch { /* Theme still works without storage. */ }
});
icons();
if (!sb) {
  message('auth-message','Proteva could not start. Please refresh this page.');
} else {
  sb.auth.onAuthStateChange((event,session)=>{
    // Supabase holds an auth lock in this callback; run async work after it returns.
    setTimeout(()=>{
      if (event==='SIGNED_OUT') clearSession();
      if (event==='PASSWORD_RECOVERY'&&session) enterApp(session.user,true);
      if (event==='SIGNED_IN'&&session&&!state.user) enterApp(session.user);
    },0);
  });
  sb.auth.getSession().then(({data,error})=>{
    if (error) throw error;
    if (data.session) return enterApp(data.session.user);
  }).catch(()=>message('auth-message','We couldn\u2019t restore your session. Please sign in again.'));
}
