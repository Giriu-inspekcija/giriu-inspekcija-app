import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../pilot/sw.js',import.meta.url),'utf8');

test('common email TLD typo is blocked before Supabase OTP request',()=>{
  assert.match(app,/'gmail.con':'gmail.com'/);
  assert.match(app,/const suggestedEmail=likelyEmailTypo\(email\)/);
  assert.match(app,/if\(signup&&suggestedEmail\)/);
  assert.ok(app.indexOf('if(signup&&suggestedEmail)')<app.indexOf('setOtpCooldown();'));
  assert.ok(app.indexOf('if(signup&&suggestedEmail)')<app.indexOf('client.auth.signInWithOtp('));
});
test('signup shows actual recipient and allows manual correction',()=>{
  assert.match(app,/rememberSignupWaiting\(email\)/);
  assert.match(app,/signupWaitingEmail'\)\.textContent/);
  assert.match(app,/Pataisykite el. paštą į/);
  assert.match(html,/Prieš siųsdami patikrinkite, kad abu adresai sutaptų/);
  assert.match(sw,/v6-signup-status/);
});
