import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const owner='11111111-1111-4111-8111-111111111111', other='44444444-4444-4444-8444-444444444444';
const person='22222222-2222-4222-8222-222222222222', otherPerson='55555555-5555-4555-8555-555555555555';

test('performance migration keeps every ownership rule and adds the indexes',async t=>{
  const db=await PGlite.create();
  t.after(()=>db.close());
  // Models the live policies read from Project Proteva on November 10, 2026.
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, anon;
    create table public.protected_people (id uuid primary key, user_id uuid not null, name text, created_at timestamptz default now());
    create table public.activity (id uuid primary key default gen_random_uuid(), user_id uuid not null, person_id uuid references public.protected_people(id) on delete cascade, text text, created_at timestamptz default now());
    create table public.scam_checks (id uuid primary key default gen_random_uuid(), user_id uuid not null, person_id uuid, verdict text, created_at timestamptz default now());
    alter table public.protected_people enable row level security;
    alter table public.activity enable row level security;
    alter table public.scam_checks enable row level security;
    create policy "Users manage their own people" on public.protected_people for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy "Users manage their own activity" on public.activity for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy "Users manage their own scam checks" on public.scam_checks for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
    grant select, insert, update, delete on public.protected_people, public.activity to authenticated;
    grant select, insert on public.scam_checks to authenticated;
    insert into public.protected_people (id,user_id,name) values ('${person}','${owner}','Rose'),('${otherPerson}','${other}','Other');
    insert into public.activity (user_id,person_id,text) values ('${owner}','${person}','mine'),('${other}','${otherPerson}','theirs');
    insert into public.scam_checks (user_id,verdict) values ('${owner}','caution'),('${other}','danger');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261110200000_rls_and_index_performance.sql',import.meta.url),'utf8'));
  const policies=(await db.query("select policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname='public' order by 1")).rows;
  assert.equal(policies.length,3);
  for (const p of policies) {
    assert.equal(p.cmd,'ALL'); assert.equal(p.roles,'{authenticated}');
    assert.match(p.qual,/SELECT auth\.uid\(\)/); assert.match(p.with_check,/SELECT auth\.uid\(\)/);
  }
  const indexes=(await db.query("select indexname from pg_indexes where schemaname='public'")).rows.map(r=>r.indexname);
  for (const name of ['activity_user_created_idx','activity_person_idx','protected_people_user_created_idx','scam_checks_person_owner_idx']) assert.ok(indexes.includes(name),name);

  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  for (const table of ['protected_people','activity','scam_checks']) {
    const rows=(await db.query('select user_id from public.'+table)).rows;
    assert.ok(rows.length>0 && rows.every(r=>r.user_id===owner),table);
  }
  await assert.rejects(db.query('insert into public.activity (user_id,text) values ($1,$2)',[other,'forged']),/row-level security/);
  await assert.rejects(db.query('insert into public.protected_people (id,user_id,name) values (gen_random_uuid(),$1,$2)',[other,'forged']),/row-level security/);
  await assert.rejects(db.query('insert into public.scam_checks (user_id,verdict) values ($1,$2)',[other,'safe']),/row-level security/);
  assert.equal((await db.query('update public.activity set text=$1 where user_id=$2',['x',other])).affectedRows,0);
  assert.equal((await db.query('delete from public.protected_people where id=$1',[otherPerson])).affectedRows,0);
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.query('select * from public.activity'),/permission denied/i);
});
