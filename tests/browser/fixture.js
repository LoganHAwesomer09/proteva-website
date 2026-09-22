export const user={id:'11111111-1111-4111-8111-111111111111',email:'caregiver@example.test',created_at:'2026-06-01T12:00:00Z',aud:'authenticated',role:'authenticated'};
export const person={id:'22222222-2222-4222-8222-222222222222',user_id:user.id,name:'Rose',relationship:'Grandmother',devices:'iPhone, iPad',birth_year:1944,protection_level:'standard',notes:'Set up together on Sunday.',created_at:'2026-06-01T12:00:00Z'};
export function event(id,tag='stopped',resolved=false) {
  return {id:String(id),user_id:user.id,person_id:person.id,text:'Sample event '+id,icon:'shield-check',tag,resolved,created_at:new Date(Date.now()-id*60000).toISOString(),detail_why:'A suspicious request appeared.',detail_did:'The request was stopped in this sample.',detail_actions:'No action needed for this sample.'};
}
export async function setup(page,options={}) {
  const db={user:{...user},people:options.empty?[]:[{...person}],activity:options.empty?[]:[event(1),event(2,'attention'),event(3,'stopped',true)],fail:null,writes:0,signupConfirmation:false,checkerFail:false,checkerMalformed:false,waitlistFail:false,signedOut:false};
  const session={access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
  if (!options.signedOut) await page.addInitScript(({session})=>{
    localStorage.setItem('sb-njjhioejdqjwpeblrewb-auth-token',JSON.stringify(session));
    if (!localStorage.getItem('proteva_theme')) localStorage.setItem('proteva_theme','light');
  },{session});
  await page.route('https://njjhioejdqjwpeblrewb.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'content-range'};
    const send=(status,body,extra={})=>route.fulfill({status,headers:{...headers,...extra},body:method==='HEAD'?'':JSON.stringify(body)});
    if (url.pathname.includes('/auth/v1/')) {
      if (url.pathname.endsWith('/logout')) { db.signedOut=true; return send(204,null); }
      if (url.pathname.endsWith('/signup')) return send(200,db.signupConfirmation?{user,session:null}:session);
      if (url.pathname.endsWith('/token')) return send(200,{...session,user:db.user});
      if (url.pathname.endsWith('/recover')) return send(200,{});
      return send(200,db.user);
    }
    const table=url.pathname.split('/').pop();
    if (table==='waitlist') { db.writes++; return send(db.waitlistFail?500:201,db.waitlistFail?{message:'Database unavailable'}:[]); }
    if (db.fail && (db.fail===method || db.fail==='ALL')) return send(500,{message:'Simulated failure',code:'XX000'});
    let rows=table==='protected_people'?db.people:db.activity;
    let filtered=rows.filter(row=>[...url.searchParams].every(([key,value])=>{
      if (value.startsWith('eq.')) return String(row[key])===value.slice(3);
      if (value.startsWith('gte.')) return row[key]>=value.slice(4);
      return true;
    }));
    if (method==='POST') {
      db.writes++; const body=req.postDataJSON();
      for (const item of Array.isArray(body)?body:[body]) rows.push({id:crypto.randomUUID(),created_at:new Date().toISOString(),...item});
      return send(201,[{id:rows.at(-1).id}]);
    }
    if (method==='PATCH') { db.writes++; for (const row of filtered) Object.assign(row,req.postDataJSON()); return send(200,filtered); }
    if (method==='DELETE') {
      db.writes++; const ids=new Set(filtered.map(row=>row.id));
      if (table==='protected_people') { db.people=rows.filter(row=>!ids.has(row.id)); db.activity=db.activity.filter(row=>!ids.has(row.person_id)); }
      else db.activity=rows.filter(row=>!ids.has(row.id));
      return send(200,filtered);
    }
    if (url.searchParams.get('order')?.includes('created_at.desc')) filtered.sort((a,b)=>b.created_at.localeCompare(a.created_at));
    const count=filtered.length;
    const offset=Number(url.searchParams.get('offset') || 0),limit=Number(url.searchParams.get('limit') || count);
    filtered=filtered.slice(offset,offset+limit);
    return send(200,filtered,{'content-range':count?'0-'+(count-1)+'/'+count:'*/0'});
  });
  await page.route('**/api/check-scam',async route=>{
    if (!route.request().headers().authorization) throw new Error('Missing bearer auth');
    await new Promise(resolve=>setTimeout(resolve,50));
    return route.fulfill({status:db.checkerFail?503:200,contentType:'application/json',body:JSON.stringify(db.checkerFail?{error:'Unavailable'}:db.checkerMalformed?{result:{verdict:'safe',headline:12}}:{result:{verdict:'caution',headline:'Verify this independently',why:'This message asks for urgent payment.',whatToDo:'Contact the company through a number you already trust.'}})});
  });
  return db;
}
export async function openView(page,view) {
  if (await page.locator('#mobile-menu').isVisible()) await page.locator('#mobile-menu').click();
  await page.locator('.nav-item[data-view="'+view+'"]').click();
  await page.waitForFunction(()=>innerWidth>800 || document.getElementById('sidebar').getBoundingClientRect().right<=0);
}
