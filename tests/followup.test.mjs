import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {conversationDraft} from '../assets/followup.js';

test('conversation drafts stay calm and never copy model-provided links or private details',()=>{
  for (const verdict of ['danger','caution','safe']) {
    const draft=conversationDraft({verdict,why:'secret-account',what_to_do:'Visit https://bad.example'},'Rose');
    assert.ok(draft.startsWith('Hi Rose,'));
    assert.ok(draft.includes('You are in charge.'));
    assert.ok(!draft.includes('secret-account'));
    assert.ok(!draft.includes('https://'));
    if (verdict==='safe') assert.ok(draft.includes('does not confirm'));
  }
  assert.ok(conversationDraft({verdict:'caution'}).startsWith('Hi,'));
});

test('Postgres migration enforces ownership and keeps follow-up separate from assessment',async t=>{
  const db=await PGlite.create();
  t.after(()=>db.close());
  await db.exec(`
    create role authenticated;
    create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, anon;
    create table public.protected_people (id uuid primary key, user_id uuid not null, name text);
    create table public.scam_checks (
      id uuid primary key, user_id uuid not null, verdict text not null,
      headline text, why text, what_to_do text, snippet text, was_photo boolean,
      created_at timestamptz default now()
    );
    alter table public.protected_people enable row level security;
    create policy people_owner on public.protected_people for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
    alter table public.scam_checks enable row level security;
    create policy legacy_checks on public.scam_checks for all to authenticated using (true) with check (true);
    grant select, insert, delete on public.protected_people to authenticated;
    grant select, insert, update on public.scam_checks to authenticated;
    insert into public.protected_people values
      ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Rose'),
      ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','Other family');
    insert into public.scam_checks (id,user_id,verdict) values
      ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','caution'),
      ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','danger');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261015175010_family_check_followups.sql',import.meta.url),'utf8'));
  const actor='11111111-1111-4111-8111-111111111111';
  const ownCheck='33333333-3333-4333-8333-333333333333';
  const otherCheck='66666666-6666-4666-8666-666666666666';
  const ownPerson='22222222-2222-4222-8222-222222222222';
  const otherPerson='55555555-5555-4555-8555-555555555555';
  await db.exec('set role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  assert.equal((await db.query('select * from public.scam_checks')).rows.length,1);
  const original=(await db.query('select * from public.scam_checks where id=$1',[ownCheck])).rows[0];
  assert.equal(original.person_id,null);
  assert.equal(original.followed_up_at,null);
  const first=(await db.query('select * from public.set_check_followup($1,true)',[ownCheck])).rows[0];
  assert.ok(first.followed_up_at);
  const repeated=(await db.query('select * from public.set_check_followup($1,true)',[ownCheck])).rows[0];
  assert.deepEqual(repeated.followed_up_at,first.followed_up_at);
  assert.equal((await db.query('select verdict from public.scam_checks where id=$1',[ownCheck])).rows[0].verdict,'caution');
  assert.deepEqual((await db.query('select * from public.set_check_followup($1,true)',[otherCheck])).rows,[]);
  assert.equal((await db.query('select * from public.set_check_followup($1,false)',[ownCheck])).rows[0].followed_up_at,null);
  await assert.rejects(db.query('select * from public.set_check_followup($1,null)',[ownCheck]));
  await assert.rejects(db.query("update public.scam_checks set verdict='safe' where id=$1",[ownCheck]));
  await assert.rejects(db.query('insert into public.scam_checks (id,user_id,verdict,person_id) values (gen_random_uuid(),$1,$2,$3)',[actor,'caution',otherPerson]),/foreign key/i);
  await db.query('insert into public.scam_checks (id,user_id,verdict,person_id) values (gen_random_uuid(),$1,$2,$3)',[actor,'caution',ownPerson]);
  await db.query('delete from public.protected_people where id=$1',[ownPerson]);
  const remaining=(await db.query('select person_id,user_id,verdict from public.scam_checks')).rows;
  assert.equal(remaining.length,2);
  assert.ok(remaining.every(r=>r.person_id===null && r.user_id===actor && r.verdict==='caution'));
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.query('select * from public.set_check_followup($1,true)',[ownCheck]),/permission denied/i);
});
