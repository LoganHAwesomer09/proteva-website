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
  await db.exec(await readFile(new URL('../supabase/migrations/20261110180000_scam_check_quotas.sql',import.meta.url),'utf8'));
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

test('established accounts get their daily allowance, then a clear account-limit denial',async t=>{
  const db=await database(t);
  await as(db,established);
  for (let i=1;i<=20;i++) {
    const row=await claim(db);
    assert.equal(row.allowed,true);
    assert.equal(row.remaining,20-i);
    assert.equal(row.limit_reason,null);
  }
  const denied=await claim(db);
  assert.equal(denied.allowed,false);
  assert.equal(denied.limit_reason,'account');
  const midnight=new Date(); midnight.setUTCHours(24,0,0,0);
  assert.equal(denied.resets_at.getTime(),midnight.getTime());
  await owner(db);
  // The denied attempt did not use up project capacity.
  assert.equal((await db.query('select checks from public.scam_check_daily_totals')).rows[0].checks,20);
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
  await db.exec('update public.scam_check_limits set per_account_daily = 0');
  await as(db,established);
  assert.equal((await claim(db)).limit_reason,'account');
  await owner(db);
  await db.exec('update public.scam_check_limits set per_account_daily = 20, project_daily = 0');
  await as(db,established);
  assert.equal((await claim(db)).limit_reason,'project');
  await owner(db);
  assert.equal((await db.query('select coalesce(sum(checks),0)::int as n from public.scam_check_usage')).rows[0].n,0);
});

test('a new UTC day starts fresh and old account history is pruned',async t=>{
  const db=await database(t);
  await db.exec(`
    insert into public.scam_check_usage values
      ('${established}', (now() at time zone 'utc')::date - 1, 20),
      ('${established}', (now() at time zone 'utc')::date - 45, 20);
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
    'update public.scam_check_limits set per_account_daily = 1000',
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
