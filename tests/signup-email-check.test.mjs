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
  assert.match(app,/Registracijos laiško užklausa priimta adresu/);
  assert.match(app,/Pataisykite adresą prieš siunčiant laišką/);
  assert.match(html,/patikrinkite pašto adresą/i);
  assert.match(sw,/v5-email-check/);
});
