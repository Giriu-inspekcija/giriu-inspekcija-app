#!/usr/bin/env node
/**
 * GI Supabase hosted Auth configuration as code.
 * The only outbound operation is a narrowly-scoped PATCH to the official Management API.
 * Never use this with a service_role / anon key; an Auth-Config Management token is required.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROJECT_REF = 'mkhxokzuietqgjdpkcqq';
export const PREVIEW_URL = 'https://deploy-preview-5--starlit-shortbread-a38110.netlify.app/pilot/';
export const LIVE_URL = 'https://starlit-shortbread-a38110.netlify.app/pilot/';
export const CLOUDFLARE_URL = 'https://komanda.giriuinspekcija.lt/pilot/';
export const CLOUDFLARE_PAGES_URL = 'https://giriu-inspekcija-app.pages.dev/pilot/';
const MANAGEMENT_URL = 'https://api.supabase.com/v1/projects/' + PROJECT_REF + '/config/auth';
const TEMPLATE_SETTINGS = Object.freeze([
  {
    file: 'confirm-signup.html',
    subjectKey: 'mailer_subjects_confirmation',
    contentKey: 'mailer_templates_confirmation_content',
    subject: 'Patvirtinkite el. paštą – Girių inspekcija',
  },
  {
    file: 'magic-link.html',
    subjectKey: 'mailer_subjects_magic_link',
    contentKey: 'mailer_templates_magic_link_content',
    subject: 'Jūsų prisijungimo nuoroda – Girių inspekcija',
  },
  {
    file: 'recovery.html',
    subjectKey: 'mailer_subjects_recovery',
    contentKey: 'mailer_templates_recovery_content',
    subject: 'Slaptažodžio atkūrimas – Girių inspekcija',
  },
]);

export function loadTemplates() {
  const values = {};
  for (const {file,subjectKey,contentKey,subject} of TEMPLATE_SETTINGS) {
    const html = readFileSync(new URL('../supabase/email-templates/' + file, import.meta.url), 'utf8');
    if ((html.match(/\{\{\s*\.ConfirmationURL\s*\}\}/g) || []).length !== 1) {
      throw Error(file + ': requires exactly one official Supabase ConfirmationURL placeholder');
    }
    if (!html.includes('lang="lt"') || !html.includes('Girių inspekcija')) {
      throw Error(file + ': missing GI Lithuanian branding');
    }
    if (!html.includes('https://raw.githubusercontent.com/Giriu-inspekcija/giriu-inspekcija-app/main/logo.png')) {
      throw Error(file + ': missing the official public GI logo');
    }
    if (/<\s*(?:script|iframe|form|object|embed)\b|on(?:click|load|error)\s*=/i.test(html)) {
      throw Error(file + ': active HTML is forbidden');
    }
    if (/sb_secret_|service_role|RESEND_API_KEY|SUPABASE_MANAGEMENT_TOKEN/.test(html)) {
      throw Error(file + ': suspicious secret identifier in template');
    }
    values[subjectKey] = subject;
    values[contentKey] = html;
  }
  return values;
}

function normalizeAllowedURLs(value) {
  if (Array.isArray(value)) {
    if (!value.every(item => typeof item === 'string')) throw Error('Invalid redirect allow list');
    return value.map(v=>v.trim()).filter(Boolean);
  }
  if (typeof value === 'string') return value.split(',').map(v=>v.trim()).filter(Boolean);
  if (value == null) return [];
  throw Error('Unknown Supabase uri_allow_list representation');
}

export function makePatch(current, templates = loadTemplates()) {
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw Error('Missing current Supabase Auth configuration');
  }
  const site = current.site_url;
  if (typeof site !== 'string') throw Error('Missing current site_url: refusing to modify Auth');
  const patch = {...templates};
  // Now that the GI Cloudflare custom domain is live, use it as the fallback
  // for OAuth/email links that omit redirectTo. Keep the old Netlify URLs
  // ALLOWED so existing users may still sign in during the transition.
  // Never overwrite an unknown external production domain.
  if (['http://localhost:3000','http://localhost:3000/',PREVIEW_URL,LIVE_URL].includes(site)) {
    patch.site_url = CLOUDFLARE_URL;
  } else {
    const candidate = new URL(site);
    if (candidate.protocol !== 'https:') throw Error('Unexpected insecure site_url; review manually');
    // Preserve known custom URL or any independently configured production URL.
  }
  const allowed = normalizeAllowedURLs(current.uri_allow_list);
  if (!allowed.includes(PREVIEW_URL)) allowed.push(PREVIEW_URL);
  if (!allowed.includes(LIVE_URL)) allowed.push(LIVE_URL);
  if (!allowed.includes(CLOUDFLARE_URL)) allowed.push(CLOUDFLARE_URL);
  if (!allowed.includes(CLOUDFLARE_PAGES_URL)) allowed.push(CLOUDFLARE_PAGES_URL);
  patch.uri_allow_list = allowed.join(',');
  // Explicitly exclude SMTP credentials and user privilege controls from the patch.
  const keys = Object.keys(patch);
  const allow = new Set([
    'site_url','uri_allow_list',
    ...TEMPLATE_SETTINGS.flatMap(x => [x.subjectKey,x.contentKey]),
  ]);
  if (keys.some(key=>!allow.has(key))) throw Error('Unexpected Auth config key');
  return patch;
}

export function diffKeys(current, desired) {
  return Object.keys(desired).filter(key => current[key] !== desired[key]);
}

export function verifyConfig(actual, desired) {
  const bad = [];
  for (const [key, value] of Object.entries(desired)) {
    if (key === 'uri_allow_list') {
      const a = normalizeAllowedURLs(actual[key]);
      const expected = normalizeAllowedURLs(value);
      if (!expected.every(url => a.includes(url))) bad.push(key);
    } else if (actual[key] !== value) bad.push(key);
  }
  return bad;
}

async function management(method, token, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(MANAGEMENT_URL, {
      method,
      signal: controller.signal,
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/json',
        ...(body ? {'content-type':'application/json'} : {}),
      },
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    // IMPORTANT: DO NOT log the full response; GET may contain SMTP credentials.
    if (!response.ok) {
      throw Error('Supabase Management API ' + method + ' failed (HTTP ' + response.status + ')');
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const action = process.argv[2] ?? '--check';
  if (!['--check','--plan','--apply'].includes(action)) throw Error('Supported modes: --check, --plan, --apply');
  const templates = loadTemplates();
  console.log('GI Auth: checked ' + TEMPLATE_SETTINGS.length + ' Lithuanian templates / official logo / secure links');
  if (action === '--check') {
    const sample = makePatch({site_url:'http://localhost:3000',uri_allow_list:''},templates);
    if (sample.site_url !== CLOUDFLARE_URL || ![PREVIEW_URL,LIVE_URL,CLOUDFLARE_URL,CLOUDFLARE_PAGES_URL].every(url=>sample.uri_allow_list.split(',').includes(url))) throw Error('Offline configuration test failed');
    console.log('Offline validation passed; no network request, no Auth change');
    return;
  }
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
  if (!token) throw Error('Missing GitHub environment secret SUPABASE_MANAGEMENT_TOKEN');
  if (action === '--apply' && process.env.GI_AUTH_ALLOW_APPLY !== 'true') {
    throw Error('Apply is only allowed by the approved GI GitHub Actions deployment job');
  }
  const current = await management('GET',token);
  const desired = makePatch(current,templates);
  const changes = diffKeys(current,desired);
  console.log('Project: GI pilot (' + PROJECT_REF + ')');
  console.log('Requested key changes: ' + (changes.length ? changes.join(', ') : 'none'));
  console.log('SMTP credentials and privileges are not read into logs or changed.');
  if (action === '--plan' || changes.length === 0) {
    console.log(action === '--plan' ? 'Plan only; no changes made' : 'Already in desired state');
    return;
  }
  // Forbid running this in pull request context or on any branch other than main.
  if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME === 'pull_request') {
    throw Error('Production Auth patch is permitted only from the reviewed main branch');
  }
  const limited = Object.fromEntries(changes.map(key => [key,desired[key]]));
  await management('PATCH',token,limited);
  const after = await management('GET',token);
  const mismatches = verifyConfig(after,desired);
  if (mismatches.length) throw Error('Auth readback mismatch: ' + mismatches.join(', '));
  console.log('PASS: Auth templates, subjects and redirect configuration verified by readback');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL('file://' + process.argv[1]))) {
  main().catch(error=>{ console.error('GI Auth: ' + error.message); process.exitCode = 1; });
}
