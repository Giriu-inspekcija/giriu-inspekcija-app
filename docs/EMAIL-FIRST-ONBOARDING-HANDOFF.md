# Girių inspekcija — šiandienos registracijos paleidimas

## Tikslas
Vienas registracijos adresas kiekvienam naujam savanoriui, naudojant **jo asmeninį el. paštą**, be papildomų Google Workspace paskyrų.
Darbo eiga: atidaro nuorodą → vardas + el. paštas → patvirtina laiško nuorodą → nustato programėlės slaptažodį → laukia koordinatoriaus / administratoriaus patvirtinimo → gauna bandomąsias užduotis.

## Jau paruošta (GitHub PR #5)
- `pilot/index.html` → registracija pirmiausia, atskiras login ir naujo slaptažodžio ekranas.
- `pilot/app.js` → `signInWithOtp` siunčia magišką el. pašto nuorodą; po grįžimo tikrinamas `gi_password_needed`, vėliau `auth.updateUser({password})`.
- `supabase/migrations/20261122175000_gi_email_onboarding_bootstrap.sql`: tik patvirtintam iš anksto nurodyto adreso turėtojui leidžiama vieną kartą aktyvuoti Master; adresas saugomas **tik** private DB konfigūracijoje.
- `supabase/migrations/20261122175500_gi_bootstrap_candidate.sql`: tikrinama teisė be master adreso atskleidimo kliento kode.
- Master tapatybės rezervavimas duomenų bazėje jau atliktas. Dar nėra aktyvaus Master, profilis atsiras tik po realios registracijos.
- Savanorį ir koordinatorių patvirtins Master per naudotojų teisių valdymo skiltį. Jokių išankstinių `@giriuinspekcija.lt` paskyrų kurti nereikia.
- Supabase RLS / SQL scenarijai išbandyti su laikinomis paskyromis ir viską atšaukiančiu ROLLBACK.
- Viešas pagrindinis Netlify demo lieka nepakeistas; pilotas kol kas PR peržiūroje.

## DABARTINIS BLOKERIS — Auth siuntimas
Supabase Free default SMTP siunčia tik Supabase organizacijos komandos el. pašto adresams, 2 laiškai/val. **Neužtenka** laisvai savanorių registracijai.
Prieš siųsdami nuorodas savanoriams, privalome įjungti custom SMTP ir patikrinti el. laišką asmeniniam, su Supabase komanda nesusietam adresui.

### Sprendimas
1. Naudoti jau turimą patikimą SMTP paslaugą, jeigu egzistuoja; kitu atveju *nemokamą* Resend SMTP paskyrą organizacijos vardu. Neįjungti overage / mokėjimų.
2. Siuntimo domenui rinktis izoliuotą subdomeną, pvz., `notify.giriuinspekcija.lt`. Resend pateiks tikrų DNS rekordų reikšmes – jų **nespėlioti**. Neperrašyti organizacijos Google Workspace MX, DKIM, SPF įrašų pagrindiniam domenui.
3. Resend SMTP: host `smtp.resend.com`, port `465`, username `resend`, password = **Resend API key (tik Supabase dashboard)**; FROM pvz., `registracija@notify.giriuinspekcija.lt` (jei patvirtintas siuntimo domenas).
4. Supabase Auth → SMTP Settings: įjungti ir išsaugoti paslaugą, siuntėjo vardas `Girių inspekcija`; palikti reikalavimą patvirtinti el. paštą.
5. Supabase Auth → URL Configuration: kol testuojame, `Site URL` nustatyti į **tikslų dabartinį PR preview /pilot/**; papildomai leisti tikslų būsimą production `/pilot/` URL, ne '*'. Po PR sujungimo perjungti Site URL.
6. Testuoti registraciją su 2 realiai valdomais adresais, įskaitant vieną ne iš Supabase komandos. Patvirtinti, kad laiške nuoroda grįžta į pilotą, nustatomas slaptažodis, po pakartotinio prisijungimo paskyra lieka `pending`.
7. Pirmas vadovas prisijungia būtent patvirtintu adresu; tik jis mato `Aktyvuoti pagrindinio administratoriaus teises`. Prieš patvirtinimą patikrinti tapatybę, šį veiksmą vadovas atlieka pats. Koordinatorę, savanorį patvirtinti tik po to.
8. Patikrinti dviejų skirtingų savanorių matomus darbus, koordinatoriaus paskirstymą, pastabų siuntimą ir `logout/login`, taip pat mobilų ekraną.
9. Įsitikinti, kad Netlify `Deploy Preview` pasiekiama testuotojui be Netlify login; jei ne, atskirai parinkti saugią bandomąją publikavimo nuorodą ir tik vadovui patvirtinus publikuoti. Nepublikuoti nepatikrinto PR į main.
10. Įvertinti teisėtą GDPR informavimą / privatumo aprašą, nes registruojami tikri el. pašto adresai ir prisijungimo metaduomenys. Paskyros turi būti tik testavimo paskirties.

## Tikros paskyrų rolės
- Vienas iš anksto vadovo patvirtintas asmeninis adresas → Master (admin) tik po patvirtinimo.
- Antra vadovo paskyra → savanorio bandymams (po Master priskyrimo).
- Koordinatorės pasirinktas el. paštas → coordinator (po Master priskyrimo).
- Visi kiti → `pending` iki patvirtinimo, tada volunteer. Jokios automatinės vidinės teisės vien dėl el. pašto.
- Slaptažodžių ir API raktų niekada nerašyti ChatGPT, GitHub, README ar pastabose.

## Nuorodos
- GitHub PR: https://github.com/Giriu-inspekcija/giriu-inspekcija-app/pull/5
- PWA preview: https://deploy-preview-5--starlit-shortbread-a38110.netlify.app/pilot/
- Supabase Auth URL: https://supabase.com/dashboard/project/mkhxokzuietqgjdpkcqq/auth/url-configuration
- Supabase SMTP: https://supabase.com/dashboard/project/mkhxokzuietqgjdpkcqq/auth/smtp
- Šaltiniai: https://supabase.com/docs/guides/auth/auth-smtp , https://supabase.com/docs/guides/auth/auth-email-passwordless , https://resend.com/pricing

## Kokie darbai dar **neatlikti**
Neįjungtas SMTP, nes šiame ChatGPT pokalbyje Supabase jungtis neturi Auth konfigūracijos arba DNS paslaugų administravimo veiksmų. Nevykdytas tikras el. pašto patvirtinimo E2E ir realių savanorių prisijungimų testas. Nėra aktyvių tikrų paskyrų.
