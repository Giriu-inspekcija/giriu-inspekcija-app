# GI / Resend → Supabase: likęs aktyvavimas (2026-11-22)

## Tikslas ir ribos
Sukurti veikiantį naujo savanorio patvirtinimo laiškų pristatymą per **patvirtintą** `notify.giriuinspekcija.lt`, neliečiant Google Workspace MX/SPF ir nesukuriant naujų Workspace pašto dėžučių. Tik sintetinės užduotys; nepublikuoti PR #5 į main be Master patvirtinimo.

## Kas PADARYTA ir patikrinta
- Hostinger vardų serveriuose: TXT `resend._domainkey.notify`, CNAME `rsend.notify → rsend-euw1.forge.rmta.net`, CNAME `send.notify → send.forge.rmta.net`. TXT ir CNAME patikrinti autoritetinguose DNS ir keliuose viešuose serveriuose.
- Resend: `notify.giriuinspekcija.lt` **Verified / Ready** (2026-11-22 ekrano patvirtinimas).
- Supabase projektas: `mkhxokzuietqgjdpkcqq`, `giriu-inspekcija-pilotas`, `ACTIVE_HEALTHY`, 2 Auth vartotojai, 3 sintetinės užduotys.
- Auth logs iki pakeitimų: `/otp` 429 `over_email_send_rate_limit`, taip pat `http://localhost:3000` referer ir `/verify` pasibaigusios nuorodos.
- GitHub PR #5: `supabase/email-templates/confirm-signup.html`, `magic-link.html`, `recovery.html`; visi lietuviški, `{{ .ConfirmationURL }}`, oficialus GI logotipas iš viešos `https://raw.githubusercontent.com/Giriu-inspekcija/giriu-inspekcija-app/main/logo.png` bylos. Naujas slaptažodis nustatomas `pilot/app.js` po el. pašto patvirtinimo.
- Šiame ChatGPT pokalbyje nėra administravimo įrankio keisti **Supabase Auth SMTP, Site URL, redirect URL, Email Templates** ar sukurti **Resend API key**. Nenaudoti SQL šiems valdymo skydelio nustatymams; nebandyti skaityti slapto rakto iš kitų šaltinių.

## Optimalus aktyvavimo kelias – oficiali native integracija
Patvirtinta: https://supabase.com/partners/catalog/resend

Resend+Supabase oficiali integracija gali **pati sukurti Resend API raktą ir suvesti SMTP konfigūraciją**. Rinktis jau egzistuojantį projektą `mkhxokzuietqgjdpkcqq`, jau patvirtintą domeną `notify.giriuinspekcija.lt`. Nenaudoti naujo Supabase projekto. `Sender name = Girių inspekcija`; pageidaujamas siuntėjo adresas `registracija@notify.giriuinspekcija.lt`. Jei automatinė integracija neleidžia pasirinkti tik domeno, rinktis minimalias leidžiamas teises ir patikrinti veiksmus prieš patvirtinimą.

**Jeigu native integracija neveikia, atsarginis rankinis kelias:**
- https://resend.com/api-keys → sukurti tik siuntimo teisės raktą, pavadinimas `GI-Supabase-Auth`, apriboti patvirtintam domenui, jei platforma leidžia.
- https://supabase.com/dashboard/project/mkhxokzuietqgjdpkcqq/auth/smtp
- Sender `registracija@notify.giriuinspekcija.lt`, name `Girių inspekcija`, SMTP host `smtp.resend.com`, port `465` (TLS), username `resend`, password = **Resend API key, įvedamas tik į Supabase**. Nieko neklijuoti į ChatGPT, GitHub, logus ar Drive.
- Išsaugoti, paskui patikrinti, ar `Enable custom SMTP` tikrai aktyvus.

## Kiti Auth nustatymai
1. https://supabase.com/dashboard/project/mkhxokzuietqgjdpkcqq/auth/url-configuration
   - Kol bandoma PR #5: `Site URL = https://deploy-preview-5--starlit-shortbread-a38110.netlify.app/pilot/`.
   - Į `Redirect URLs` pridėti tą patį tikslų adresą, o būsimą `https://starlit-shortbread-a38110.netlify.app/pilot/` – tik kai ši versija tikrai bus paskelbta. Nenaudoti plačių `*` wildcard.
   - Programėlė siunčia `emailRedirectTo = window.location.origin + window.location.pathname`, todėl reikia leidimų būtent tame `/pilot/` kelyje.
2. https://supabase.com/dashboard/project/mkhxokzuietqgjdpkcqq/auth/templates
   - Confirm signup, subject: `Patvirtinkite el. paštą – Girių inspekcija`, HTML iš GitHub `supabase/email-templates/confirm-signup.html`
   - Magic Link, subject: `Prisijungimas – Girių inspekcija`, HTML iš `supabase/email-templates/magic-link.html`
   - Reset Password / Recovery, subject: `Slaptažodžio atkūrimas – Girių inspekcija`, HTML iš `supabase/email-templates/recovery.html`
   - **Nekeisti `{{ .ConfirmationURL }}`**, jis generuoja vienkartinę Supabase patvirtinimo nuorodą.
3. https://supabase.com/dashboard/project/mkhxokzuietqgjdpkcqq/auth/rate-limits – patikrinti ribas; nekelti jų virš Resend plano galimybių. Įjungti CAPTCHA / abuse protection prieš masinį viešą registravimą.
4. Supabase Security Advisor šiuo metu praneša `auth_leaked_password_protection` – svarstyti įjungti HIBP slaptažodžių patikrą, jei funkcija prieinama plane.
5. Netlify `Who can see it`: įsitikinti, kad savanorį atidarantis privatus naršyklės langas mato GI registraciją, o **ne** `This site is private – Sign in to Netlify`. Tai neturi reikšti, kad pateikiamos GI vidinės užduotys: jas saugo Supabase JWT + RLS.

## Būtinas galutinis E2E
1. Naujas testinis asmeninis el. pašto adresas, kuris nėra Supabase organizacijos komandos narys; registracija su išgalvotu vardu ir `membership_intent=new_candidate`.
2. Resend → Emails: patikrinti pristatymo `delivered`/klaidos įrašą, atsižvelgti į el. dėžutę ir šlamšto katalogą.
3. Gavėjo laiške matomas GI pavadinimas, logotipas ir lietuviškas mygtukas. Nuoroda veda į **GI Netlify /pilot/**, ne `localhost:3000`.
4. Susikuria slaptažodį, prisijungia, `gi_profiles.role = pending`. Nieko pats nepasikelia į `volunteer/coordinator/admin`.
5. Master `zelaurynas@gmail.com` po el. pašto patvirtinimo **pats** aktyvuoja rezervuotas Master teises; `laurynas@giriuinspekcija.lt` lieka bandomasis savanoris.
6. Master/koordinatorius patvirtina naują kandidatą ir priskiria vieną `candidate_safe` sintetinę užduotį; kandidatas negali atidaryti svetimų užduočių; pateikia rezultatą; staff patvirtina.
7. Tik po to galima svarstyti PR #5 → main ir viešą savanorių kvietimą.

## Patikimas faktų atskyrimas
Šis failas yra **operacijų perdavimo instrukcija**, o ne įrodymas, kad SMTP / Auth konfigūracija jau pakeista. Be tiesioginio administravimo skydelio pakeitimo ir gauto testinio laiško sistemos **nevadinti veikiančia registracija**.

Oficialūs šaltiniai:
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/partners/catalog/resend
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://resend.com/supabase
