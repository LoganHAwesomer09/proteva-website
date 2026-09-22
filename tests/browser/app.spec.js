import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setup, openView, event } from './fixture.js';

test('sample events stay labeled and expand correctly in a person view',async({page})=>{
  const db=await setup(page); await page.goto('/app.html');
  await page.locator('[data-action="simulate"]').click();
  await page.locator('#simulation-btn').click();
  await expect(page.locator('#simulation-dialog')).not.toBeVisible();
  expect(db.activity.at(-1).text).toMatch(/^Sample:/);
  await openView(page,'family');
  await expect(page.locator('#member-list .pill')).toHaveText('3 active');
  await page.locator('#member-list [data-person]').click();
  await page.locator('#person-content summary').first().click();
  await expect(page.locator('#person-content .detail').first()).toBeVisible();
  await page.locator('#person-content [data-archive]').first().click();
  await expect(page.locator('#person-content .feed-item')).toHaveCount(4);
  await expect(page.locator('#view-person')).toBeVisible();
});
test('long profile values, invalid years and database text remain safe on a phone',async({page})=>{
  const db=await setup(page);
  db.people[0].name='A'.repeat(100);
  db.activity[0].text='<img src=x onerror=alert(1)>';
  db.activity[0].icon='<img src=x onerror=alert(1)>';
  await page.setViewportSize({width:375,height:812});
  await page.goto('/app.html');
  await expect(page.locator('#dashboard-content img')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await openView(page,'family');
  await page.locator('[data-edit]').click();
  await page.locator('#member-birthyear').fill('1944.5');
  await page.locator('#save-member-btn').click();
  expect(db.writes).toBe(0);
  await page.locator('#member-birthyear').fill(String(new Date().getFullYear()+1));
  await page.locator('#save-member-btn').click();
  expect(db.writes).toBe(0);
  await page.locator('#member-birthyear').fill('');
  await page.locator('#member-notes').fill('N'.repeat(1000));
  await page.locator('#save-member-btn').click();
  await expect(page.locator('#member-dialog')).not.toBeVisible();
  await page.locator('#member-list [data-person]').click();
  await expect(page.locator('#person-content h1')).toHaveText('A'.repeat(100));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('each caregiver receives their own onboarding after an account switch',async({page})=>{
  const db=await setup(page,{empty:true}); await page.goto('/app.html');
  await page.locator('[data-action="ob-skip"]').click();
  await page.locator('#account-btn').click(); await page.locator('#account-menu [data-action="logout"]').click();
  await expect(page.locator('#auth-screen')).toBeVisible();
  db.user={...db.user,id:'33333333-3333-4333-8333-333333333333',email:'second@example.test'};
  await page.locator('#email').fill('second@example.test'); await page.locator('#password').fill('Example-test-only-42'); await page.locator('#auth-btn').click();
  await expect(page.locator('#onboarding-dialog')).toBeVisible();
  await expect(page.locator('#account-email')).toHaveText('second@example.test');
});
test('public pages and sign-in pass accessibility checks',async({page})=>{
  await setup(page,{signedOut:true});
  for(const path of ['/','/me.html','/app.html']) {
    await page.goto(path);
    const results=await new AxeBuilder({page}).analyze();
    expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  }
});


test('sign-in, signup confirmation, password visibility, and session logout',async({page})=>{
  const db=await setup(page,{signedOut:true});
  await page.goto('/app.html');
  await page.getByRole('button',{name:'Show password',exact:true}).click();
  await expect(page.locator('#password')).toHaveAttribute('type','text');
  await page.locator('#auth-toggle').click();
  db.signupConfirmation=true;
  await page.locator('#email').fill('new@example.test');
  await page.locator('#password').fill('Example-test-only-42');
  await page.locator('#password').press('Enter');
  await expect(page.locator('#auth-message')).toContainText('Check your email');
  await expect(page.locator('#auth-title')).toHaveText('Welcome back');
  await page.locator('#auth-btn').click();
  await expect(page.locator('#stat-people')).toHaveText('1');
  await page.locator('#account-btn').click();
  await page.locator('#account-menu [data-action="logout"]').click();
  await expect(page.locator('#auth-screen')).toBeVisible();
  await expect(page.locator('#dashboard-content')).toBeEmpty();
  expect(db.signedOut).toBe(true);
});
test('stopped totals include archives and are not capped by feed page size',async({page})=>{
  const db=await setup(page);
  db.activity=Array.from({length:26},(_,i)=>event(i+1,'stopped',i===25)).concat(event(99,'attention'));
  await page.goto('/app.html');
  await expect(page.locator('#stat-stopped')).toHaveText('26');
  await expect(page.locator('#stat-attention')).toHaveText('1');
  await expect(page.locator('.feed-item')).toHaveCount(20);
  await page.getByRole('button',{name:'Load more activity'}).click();
  await expect(page.locator('.feed-item')).toHaveCount(26);
  await page.locator('[data-archive="1"]').click();
  await expect(page.locator('#stat-stopped')).toHaveText('26');
  expect(db.activity.find(row=>row.id==='1').resolved).toBe(true);
  await openView(page,'history');
  await expect(page.locator('#history-feed .feed-item')).toHaveCount(2);
  await page.locator('#history-feed summary').first().click();
  await expect(page.locator('#history-feed .detail').first()).toBeVisible();
});
test('family add, edit, details and explicit removal preserve input on failed saves',async({page})=>{
  const db=await setup(page); await page.goto('/app.html'); await openView(page,'family');
  await page.locator('#view-family [data-action="add-member"]').click();
  await page.locator('#member-name').fill('Avery <img src=x onerror=alert(1)>');
  await page.locator('#member-relationship').selectOption('Other');
  await page.locator('#member-other').fill('Neighbor');
  await page.locator('#member-devices').fill('Android phone');
  await page.locator('#member-birthyear').fill('1947');
  db.fail='POST';
  await page.locator('#save-member-btn').click();
  await expect(page.locator('#member-message')).toContainText('couldn');
  await expect(page.locator('#member-name')).toHaveValue('Avery <img src=x onerror=alert(1)>');
  db.fail=null;
  await page.locator('#save-member-btn').click();
  await expect(page.locator('#member-dialog')).not.toBeVisible();
  await expect(page.locator('#member-list .member')).toHaveCount(2);
  await expect(page.locator('#member-list img')).toHaveCount(0);
  const created=db.people.at(-1);
  await page.locator('[data-edit="'+created.id+'"]').click();
  await expect(page.locator('#member-other')).toHaveValue('Neighbor');
  await page.locator('#member-name').fill('Avery');
  await page.locator('#member-notes').fill('Call together this weekend.');
  await page.locator('#save-member-btn').click();
  await page.locator('[data-person="'+created.id+'"]').click();
  await expect(page.locator('#person-content h1')).toHaveText('Avery');
  await expect(page.locator('.person-notes')).toHaveText('Call together this weekend.');
  await openView(page,'family');
  await page.locator('[data-delete="'+created.id+'"]').click();
  await page.getByRole('button',{name:'Keep member'}).click();
  expect(db.people.length).toBe(2);
  await page.locator('[data-delete="'+created.id+'"]').click();
  await page.locator('#delete-confirm').click();
  await expect(page.locator('#member-list .member')).toHaveCount(1);
});
test('onboarding supports consent, back, validation, completion, and account-scoped storage',async({page})=>{
  const db=await setup(page,{empty:true}); await page.goto('/app.html');
  await expect(page.locator('#onboarding-dialog')).toBeVisible();
  await page.locator('[data-action="ob-next"]').click();
  await page.locator('[data-action="ob-next"]').click();
  await expect(page.locator('#ob-consent-message')).toBeVisible();
  await page.locator('#ob-consent').check();
  await page.locator('[data-action="ob-next"]').click();
  await page.locator('#ob-name').fill('Sam');
  await page.locator('#ob-devices').fill('iPad');
  await page.locator('[data-action="ob-back"]').click();
  await expect(page.locator('#ob-consent')).toBeChecked();
  await page.locator('[data-action="ob-next"]').click();
  await expect(page.locator('#ob-name')).toHaveValue('Sam');
  await page.getByRole('button',{name:'Add & continue'}).click();
  await expect(page.locator('#onboarding-content')).toContainText('Device protection is not active');
  expect(db.people.length).toBe(1);
  await page.getByRole('button',{name:'Go to my dashboard'}).click();
  await expect(page.locator('#stat-people')).toHaveText('1');
  expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('proteva_onboarded:')))).toBe(true);
});
test('skipping onboarding stays calm and is not saved as a global preference',async({page})=>{
  await setup(page,{empty:true}); await page.goto('/app.html');
  await page.locator('[data-action="ob-skip"]').click();
  await expect(page.locator('#onboarding-dialog')).not.toBeVisible();
  await expect(page.locator('#stat-people')).toHaveText('0');
  expect(await page.evaluate(()=>localStorage.getItem('proteva_onboarded'))).toBe(null);
});
test('load errors do not claim safety, mutations do not silently succeed',async({page})=>{
  const db=await setup(page); db.fail='GET'; await page.goto('/app.html');
  await expect(page.locator('#dashboard-content')).toContainText('couldn');
  await expect(page.locator('#stat-stopped')).toHaveCount(0);
  db.fail=null; await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.locator('#stat-stopped')).toHaveText('2');
  db.fail='PATCH'; await page.locator('[data-archive="1"]').click();
  await expect(page.locator('#toast')).toContainText('couldn');
  expect(db.activity[0].resolved).toBe(false);
});
test('scam checker handles success, server failure and malformed output',async({page})=>{
  const db=await setup(page); await page.goto('/app.html'); await openView(page,'checker');
  await page.locator('#checker-input').fill('Your account is locked. Send a payment right away.');
  await page.locator('#checker-btn').click();
  await expect(page.locator('#checker-result')).toContainText('Verify this independently');
  await expect(page.locator('#checker-result')).toContainText('Your next step');
  db.checkerFail=true;
  await page.locator('#checker-btn').click();
  await expect(page.locator('#checker-result')).toContainText('couldn');
  await expect(page.locator('#checker-btn')).toBeEnabled();
  db.checkerFail=false; db.checkerMalformed=true;
  await page.locator('#checker-btn').click();
  await expect(page.locator('#checker-result')).toContainText('couldn');
});
test('password confirmation and dark mode work across navigation and reload',async({page})=>{
  await setup(page); await page.goto('/app.html'); await openView(page,'settings');
  await page.locator('#new-password').fill('Example-password-only');
  await page.locator('#confirm-password').fill('Different-example-password');
  await page.locator('#password-btn').click();
  await expect(page.locator('#password-message')).toContainText('don');
  await page.locator('#confirm-password').fill('Example-password-only');
  await page.locator('#password-btn').click();
  await expect(page.locator('#password-message')).toContainText('updated');
  await page.locator('#theme-toggle').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await openView(page,'family');
  await page.locator('#view-family [data-action="add-member"]').click();
  expect(await page.locator('#member-dialog').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
  await page.keyboard.press('Escape');
  await expect(page.locator('#member-dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});
test('homepage waitlist supports failure, retry and duplicate-submit protection',async({page})=>{
  const db=await setup(page,{signedOut:true}); db.waitlistFail=true;
  await page.goto('/');
  await expect(page.locator('#proteva-gate')).toHaveCount(0);
  await page.locator('#waitlist-email').fill('preview@example.test');
  await page.locator('#waitlist-email').press('Enter');
  await expect(page.locator('#waitlist-message')).toContainText('couldn');
  db.waitlistFail=false;
  await page.locator('#join-btn').click();
  await expect(page.locator('#waitlist-message')).toContainText('on the list');
  await expect(page.locator('#waitlist-form')).not.toBeVisible();
  expect(db.writes).toBe(2);
});
test('keyboard dialogs and accessibility checks cover light and dark interfaces',async({page})=>{
  await setup(page); await page.goto('/app.html'); await expect(page.locator('#stat-people')).toHaveText('1');
  for (const view of ['dashboard','family','checker','settings','help']) {
    await openView(page,view);
    await expect(page.locator('#view-'+view+' .loading:visible')).toHaveCount(0);
    const results=await new AxeBuilder({page}).analyze();
    expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  }
  await openView(page,'settings'); await page.locator('#theme-toggle').check();
  await openView(page,'family'); await page.locator('#view-family [data-action="add-member"]').click();
  await expect(page.locator('#member-dialog')).toBeVisible();
  const results=await new AxeBuilder({page}).analyze();
  expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#view-family [data-action="add-member"]')).toBeFocused();
});
for (const width of [1440,1024,768,430,375]) {
  test('responsive visual check at '+width+'px',async({page},testInfo)=>{
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    page.on('console',entry=>{ if(entry.type()==='error') errors.push(entry.text()); });
    await setup(page);
    await page.setViewportSize({width,height:900});
    await page.goto('/app.html'); await expect(page.locator('#stat-people')).toHaveText('1');
    for (const view of ['dashboard','family','history','checker','settings','help']) {
      await openView(page,view);
      await expect(page.locator('#view-'+view+' .loading:visible')).toHaveCount(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await openView(page,'dashboard');
    await page.screenshot({path:testInfo.outputPath('overview-'+width+'.png'),fullPage:true});
    await openView(page,'family'); await page.locator('#view-family [data-action="add-member"]').click();
    expect(await page.locator('#member-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('member-'+width+'.png')});
    await page.keyboard.press('Escape');
    await openView(page,'settings'); await page.locator('#theme-toggle').check(); await openView(page,'dashboard');
    await page.screenshot({path:testInfo.outputPath('dark-'+width+'.png'),fullPage:true});
    await page.goto('/');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('home-'+width+'.png'),fullPage:true});
    await page.goto('/me.html');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
