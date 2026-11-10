import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const established='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const fresh='33333333-3333-4333-8333-333333333333';
const fresh2='44444444-4444-4444-8444-444444444444';
const anonymous='55555555-5555-4555-8555-555555555555';

// Models the parts of Supabase the migration relies on, including the default grants
// Supabase gives anon/authenticated on new tables and functions in public.
async function database(t) {
  const db=await PGlite.create();
  t.after(()=>db.close());
  await db.exec(`
    create role authenticated;
    create role anon;
    create schema auth;
    create table auth.users (id uuid primary key, created_at timestamptz not null);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth, public to authenticated, anon;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    insert into auth.users values
      ('${established}', now() - interval '30 days'),
      ('${other}', now() - interval '2 days'),
      ('${fresh}', now() - interval '1 hour'),
      ('${fresh2}', now() - interval '2 hours'),
      ('${anonymous}', now() - interval '30 days');
  `);
  for (const name of ['20261110180000_scam_check_quotas.sql','20261110190000_plan_based_check_limits.sql'])
    await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  return db;
}
async function as(db,user,claims={}) {
  await db.exec('reset role; set role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,role:'authenticated',...claims})]);
}
async function owner(db) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','',false);");
}
const claim=async db=>(await db.query('select * from public.claim_scam_check()')).rows[0];

test('established free accounts get their daily allowance, then a clear account-limit denial',async t=>{
  const db=await database(t);
  await as(db,established);
  for (let i=1;i<=10;i++) {
    const row=await claim(db);
    assert.equal(row.allowed,true);
    assert.equal(row.remaining,10-i);
    assert.equal(row.limit_reason,null);
  }
  const denied=await claim(db);
  assert.equal(denied.allowed,false);
  assert.equal(denied.limit_reason,'account');
  const midnight=new Date(); midnight.setUTCHours(24,0,0,0);
  assert.equal(denied.resets_at.getTime(),midnight.getTime());
  await owner(db);
  // The denied attempt did not use up project capacity.
  assert.equal((await db.query('select checks from public.scam_check_daily_totals')).rows[0].checks,10);
});

test('accounts created in the last day get a smaller allowance',async t=>{
  const db=await database(t);
  await as(db,fresh);
  for (let i=0;i<5;i++) assert.equal((await claim(db)).allowed,true);
  assert.equal((await claim(db)).limit_reason,'account');
});

test('the project-wide cap stops everyone and gives the account slot back',async t=>{
  const db=await database(t);
  await db.exec('update public.scam_check_limits set project_daily = 3');
  await as(db,established);
  for (let i=0;i<3;i++) assert.equal((await claim(db)).allowed,true);
  await as(db,other);
  const denied=await claim(db);
  assert.equal(denied.allowed,false);
  assert.equal(denied.limit_reason,'project');
  await owner(db);
  const usage=(await db.query('select user_id,checks from public.scam_check_usage order by checks desc')).rows;
  assert.deepEqual(usage.map(r=>[r.user_id,r.checks]),[[established,3],[other,0]]);
});

test('a burst of new accounts cannot use up capacity reserved for existing families',async t=>{
  const db=await database(t);
  await db.exec('update public.scam_check_limits set new_accounts_project_daily = 3, project_daily = 10');
  await as(db,fresh);
  for (let i=0;i<3;i++) assert.equal((await claim(db)).allowed,true);
  await as(db,fresh2);
  assert.equal((await claim(db)).limit_reason,'project');
  await as(db,established);
  assert.equal((await claim(db)).allowed,true);
  await owner(db);
  const totals=(await db.query('select checks,new_account_checks from public.scam_check_daily_totals')).rows[0];
  assert.deepEqual([totals.checks,totals.new_account_checks],[4,3]);
});

test('zero limits deny without creating usage',async t=>{
  const db=await database(t);
  await db.exec("update public.scam_check_plans set daily_checks = 0 where plan = 'free'");
  await as(db,established);
  assert.equal((await claim(db)).limit_reason,'account');
  await owner(db);
  await db.exec("update public.scam_check_plans set daily_checks = 10 where plan = 'free'; update public.scam_check_limits set project_daily = 0");
  await as(db,established);
  assert.equal((await claim(db)).limit_reason,'project');
  await owner(db);
  assert.equal((await db.query('select coalesce(sum(checks),0)::int as n from public.scam_check_usage')).rows[0].n,0);
});

test('a new UTC day starts fresh and old account history is pruned',async t=>{
  const db=await database(t);
  await db.exec(`
    insert into public.scam_check_usage values
      ('${established}', (now() at time zone 'utc')::date - 1, 10),
      ('${established}', (now() at time zone 'utc')::date - 45, 10);
    insert into public.scam_check_daily_totals values ((now() at time zone 'utc')::date - 1, 300, 0);
  `);
  await as(db,established);
  assert.equal((await claim(db)).allowed,true);
  await owner(db);
  const days=(await db.query("select ((now() at time zone 'utc')::date - usage_day) as age from public.scam_check_usage order by age")).rows.map(r=>r.age);
  assert.deepEqual(days,[0,1]);
});

test('signed-in users cannot read, change, or reset limits and counters directly',async t=>{
  const db=await database(t);
  await as(db,established);
  await claim(db);
  for (const sql of [
    'select * from public.scam_check_usage',
    'select * from public.scam_check_daily_totals',
    'select * from public.scam_check_limits',
    'update public.scam_check_limits set project_daily = 100000',
    "update public.scam_check_plans set daily_checks = 100000",
    'select * from public.account_plans',
    `insert into public.account_plans (user_id, plan) values ('${established}', 'shield')`,
    'delete from public.scam_check_usage',
    `insert into public.scam_check_daily_totals values (current_date, 0, 0)`
  ]) await assert.rejects(db.query(sql),/permission denied/i,sql);
});

test('anonymous sessions, missing sessions, and the anon role are rejected',async t=>{
  const db=await database(t);
  await as(db,anonymous,{is_anonymous:true});
  await assert.rejects(claim(db),/Sign in/);
  await as(db,'');
  await assert.rejects(claim(db),/Sign in/);
  await as(db,'99999999-9999-4999-8999-999999999999');
  await assert.rejects(claim(db),/Sign in/);
  await db.exec('reset role; set role anon;');
  await assert.rejects(claim(db),/permission denied/i);
  await owner(db);
  assert.equal((await db.query('select count(*)::int as n from public.scam_check_daily_totals')).rows[0].n,0);
});

test('missing limits fail closed and deleting an account removes its usage',async t=>{
  const db=await database(t);
  await as(db,established);
  await claim(db);
  await owner(db);
  await db.query('delete from auth.users where id=$1',[established]);
  assert.equal((await db.query('select count(*)::int as n from public.scam_check_usage')).rows[0].n,0);
  await db.exec('delete from public.scam_check_limits');
  await as(db,other);
  await assert.rejects(claim(db),/not configured/);
});

test('paid plans get their own allowance, including brand-new paid accounts',async t=>{
  const db=await database(t);
  await db.exec(`insert into public.account_plans (user_id, plan) values ('${established}','home'), ('${fresh}','family')`);
  await as(db,established);
  for (let i=1;i<=25;i++) assert.equal((await claim(db)).remaining,25-i);
  assert.equal((await claim(db)).limit_reason,'account');
  await as(db,fresh);
  for (let i=0;i<6;i++) assert.equal((await claim(db)).allowed,true);
  await owner(db);
  // A paid account is not counted against the new-account slice.
  assert.equal((await db.query('select new_account_checks from public.scam_check_daily_totals')).rows[0].new_account_checks,0);
});

test('the usage summary reports plan, limit and today\'s count without using a check',async t=>{
  const db=await database(t);
  await as(db,established);
  const usage=async()=>(await db.query('select * from public.get_scam_check_usage()')).rows[0];
  let row=await usage();
  assert.deepEqual([row.plan,row.plan_name,row.daily_limit,row.used_today],['free','Free',10,0]);
  await claim(db); await claim(db);
  row=await usage(); await usage();
  assert.equal(row.used_today,2);
  const midnight=new Date(); midnight.setUTCHours(24,0,0,0);
  assert.equal(row.resets_at.getTime(),midnight.getTime());
  await as(db,fresh);
  assert.equal((await usage()).daily_limit,5);
  await owner(db);
  await db.exec(`insert into public.account_plans values ('${fresh}','shield',now())`);
  await as(db,fresh);
  row=await usage();
  assert.deepEqual([row.plan_name,row.daily_limit],['Shield',100]);
  await owner(db);
  assert.equal((await db.query('select sum(checks)::int as n from public.scam_check_usage')).rows[0].n,2);
  await as(db,anonymous,{is_anonymous:true});
  await assert.rejects(usage(),/Sign in/);
  await db.exec('reset role; set role anon;');
  await assert.rejects(usage(),/permission denied/i);
});

test('plan details are public, but caregivers can only record their own interest in paid plans',async t=>{
  const db=await database(t);
  await db.exec('reset role; set role anon;');
  const plans=(await db.query('select plan,daily_checks,monthly_price_cents from public.scam_check_plans order by sort_order')).rows;
  assert.deepEqual(plans.map(p=>[p.plan,p.daily_checks,p.monthly_price_cents]),[['free',10,null],['home',25,1000],['family',50,2000],['shield',100,3500]]);
  await assert.rejects(db.query("insert into public.plan_interest (plan) values ('family')"),/permission denied/i);
  await as(db,established);
  await db.query("insert into public.plan_interest (plan) values ('family')");
  await assert.rejects(db.query("insert into public.plan_interest (plan) values ('family')"),/duplicate key/);
  await assert.rejects(db.query("insert into public.plan_interest (plan) values ('free')"),/row-level security/);
  await assert.rejects(db.query(`insert into public.plan_interest (user_id, plan) values ('${other}','home')`),/permission denied/i);
  await assert.rejects(db.query("insert into public.plan_interest (plan) values ('platinum')"),/foreign key/i);
  await as(db,other);
  assert.equal((await db.query('select * from public.plan_interest')).rows.length,0);
  await as(db,established);
  assert.deepEqual((await db.query('select plan from public.plan_interest')).rows,[{plan:'family'}]);
});
