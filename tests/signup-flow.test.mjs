import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../pilot/sw.js',import.meta.url),'utf8');

test('signup requires second email entry; common .con typos blocked before OTP',()=>{
  assert.match(html,/<input id="emailConfirm" type="email"[^>]+required/);
  assert.match(js,/\$\('emailConfirm'\)\.required=signup/);
  assert.match(js,/if\(signup&&email!==\$\('emailConfirm'\)\.value\.trim\(\)\.toLowerCase\(\)\)/);
  assert.ok(js.indexOf("if(signup&&email!==$('emailConfirm')")<js.indexOf("client.auth.signInWithOtp("));
  assert.match(js,/'gmail.con':'gmail.com'/);
  assert.ok(js.indexOf('if(signup&&suggestedEmail)')<js.indexOf("client.auth.signInWithOtp("));
});

test('waiting UI shows actual address and steps without exposing accounts',()=>{
  for(const id of ['signupWaiting','signupWaitingTitle','signupWaitingEmail','signupWaitingStatus',
    'checkSignupStatus','editSignupEmail','stopSignup','resendSignupEmail']){
    assert.match(html,new RegExp('id="'+id+'"'));
    assert.match(js,new RegExp(id));
  }
  assert.match(html,/Patvirtinti el\. paštą/);
  assert.match(js,/signupWaitingEmail'\)\.textContent/);
  assert.match(js,/client\.auth\.getSession\(\)/);
  assert.match(js,/client\.auth\.getUser\(\)/);
  assert.match(js,/negalima/i);
});

test('registration progress does not falsely cancel an Auth account or bypass OTP rate limits',()=>{
  assert.match(js,/const OTP_COOLDOWN_MS = 120000/);
  assert.match(js,/if\(otpRequestInFlight\|\|otpRemainingSeconds\(\)>0\)return/);
  assert.match(js,/Jau išsiųsto laiško tai neatšaukia/);
  assert.doesNotMatch(js,/client\.auth\.admin\.deleteUser/);
  assert.doesNotMatch(js,/supabase\.auth\.admin/);
});

test('signup text is concise, no Workspace mailbox demand, mobile fields fit',()=>{
  assert.doesNotMatch(html,/Savanoriams nereikia organizacijos Google Workspace paskyros/);
  assert.match(html,/Tik bandomosios užduotys/);
  assert.match(html,/width:100%;max-width:100%/);
  assert.match(html,/overflow-wrap:anywhere/);
  assert.match(sw,/v6-signup-status/);
});

test('registered pending volunteer receives explicit coordinator-status feedback',()=>{
  assert.match(js,/Būsena nepasikeitė: laukiate koordinatoriaus patvirtinimo/);
  assert.match(html,/Laukiama koordinatoriaus patvirtinimo/);
});
