import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {setup,openView,person,user} from './fixture.js';

async function checkForRose(page) {
  await page.goto('/app.html'); await openView(page,'checker');
  await page.locator('#checker-person').selectOption(person.id);
  await page.locator('#checker-input').fill('Please send a payment urgently.');
  await page.locator('#checker-btn').click();
  await expect(page.locator('#checker-result')).toContainText('Assessment saved to History.');
}

test('a linked check appears only for its person and follow-up survives reload and undo',async({page})=>{
  const db=await setup(page);
  db.people.push({...person,id:'77777777-7777-4777-8777-777777777777',name:'Alex'});
  await checkForRose(page);
  expect(db.checkerRequests[0].person_id).toBe(person.id);
  await page.locator('#checker-result [data-followup]').check();
  await expect(page.locator('#checker-result')).toContainText('Assessment unchanged');
  expect(db.checks[0].verdict).toBe('caution');
  await page.reload(); await openView(page,'family');
  await page.locator('#member-list [data-person="'+person.id+'"]').click();
  await expect(page.locator('#person-content')).toContainText('Verify this independently');
  await expect(page.locator('#person-content [data-followup]')).toBeChecked();
  await page.locator('#person-content [data-followup]').uncheck();
  await expect(page.locator('#toast')).toContainText('Follow-up undone');
  expect(db.checks[0].followed_up_at).toBeNull();
  await page.locator('#person-content [data-check-person]').click();
  await expect(page.locator('#checker-person')).toHaveValue(person.id);
  await openView(page,'family'); await page.locator('#member-list [data-person="77777777-7777-4777-8777-777777777777"]').click();
  await expect(page.locator('#person-content')).not.toContainText('Verify this independently');
});

test('failed and zero-row follow-ups revert the checkbox instead of claiming success',async({page})=>{
  const db=await setup(page); await checkForRose(page);
  const toggle=page.locator('#checker-result [data-followup]');
  db.fail='POST'; await toggle.check();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('#toast')).toContainText('could not save');
  db.fail=null; db.checks=[];
  await toggle.check(); await expect(toggle).not.toBeChecked();
  await expect(page.locator('#toast')).toContainText('could not save');
});

test('conversation is editable, copied only on request, and cleared on logout',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await setup(page); await checkForRose(page);
  await page.locator('#checker-result [data-talk]').click();
  await expect(page.locator('#conversation-draft')).toHaveValue(/^Hi Rose,/);
  await page.locator('#conversation-draft').fill('Hi Rose, can we look at this together?');
  await page.locator('#copy-conversation').click();
  await expect(page.locator('#conversation-message')).toContainText('Message copied');
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('Hi Rose, can we look at this together?');
  await page.keyboard.press('Escape');
  await page.locator('#account-btn').click();
  await page.locator('#account-menu [data-action="logout"]').click();
  await expect(page.locator('#conversation-draft')).toHaveValue('');
  await expect(page.locator('#checker-result')).toBeEmpty();
});

test('unsaved and older unlinked checks can be discussed without inventing a follow-up save',async({page})=>{
  const db=await setup(page); db.historySaveFail=true;
  db.checks.push({id:'88888888-8888-4888-8888-888888888888',user_id:user.id,verdict:'safe',headline:'No warning signs',created_at:new Date().toISOString()});
  await page.goto('/app.html'); await openView(page,'checker');
  await page.locator('#checker-input').fill('Please send a payment urgently.');
  await page.locator('#checker-btn').click();
  await expect(page.locator('#checker-result')).toContainText('could not be saved');
  await expect(page.locator('#checker-result [data-followup]')).toHaveCount(0);
  await page.locator('#checker-result [data-talk]').click();
  await expect(page.locator('#conversation-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await openView(page,'history');
  await expect(page.locator('#history-feed')).toContainText('Not linked to a family member');
  await page.locator('#history-feed [data-talk]').click();
  await expect(page.locator('#conversation-draft')).toHaveValue(/does not confirm/);
});

for (const width of [1440,375]) test('follow-up and conversation layout at '+width,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});
  await setup(page); await checkForRose(page);
  await page.evaluate(()=>scrollTo(0,0));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('checker.png'),fullPage:true});
  await page.locator('#checker-result [data-talk]').click();
  const axe=await new AxeBuilder({page}).analyze();
  expect(axe.violations.map(v=>v.id)).toEqual([]);
  expect(await page.locator('#conversation-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('conversation.png')});
});
