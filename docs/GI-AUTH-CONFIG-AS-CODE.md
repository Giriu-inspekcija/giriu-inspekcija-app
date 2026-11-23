# „Girių inspekcija“ – Supabase Auth konfigūracija iš GitHub (be Cloud Browser)

## Būsena (2026-11-22)
- Supabase projektas: `mkhxokzuietqgjdpkcqq` (naudoti TIK esamą GI pilotą).
- Resend `notify.giriuinspekcija.lt`: **Verified/Ready**; SMTP susietas su Supabase (`registracija@notify.giriuinspekcija.lt`). Supabase Auth žurnalas patvirtino el. laiškų kvotos pasikeitimą iš 2 iki 25 per valandą. **Tai NEPATVIRTINA konkretaus laiško pristatymo**.
- Trys LT šablonai: `supabase/email-templates/confirm-signup.html`, `magic-link.html`, `recovery.html`; oficialus GI logo, `{{ .ConfirmationURL }}`.
- API dokumentacija patvirtina `GET/PATCH https://api.supabase.com/v1/projects/{ref}/config/auth`; PATCH laukai `site_url`, `uri_allow_list`, `mailer_subjects_*`, `mailer_templates_*_content`.
- Viešai publikuojamas Auth PAT raktas **draudžiamas**. Repo `Giriu-inspekcija/giriu-inspekcija-app` yra PUBLIC. Nepersistenkite su teisių plėtimu.

## Ką įdiegėme į GitHub
- `scripts/sync-supabase-auth.mjs`: aiškiai užrakintas GI projekto ID, tik 3 LT laiškų šablonai ir konkreti `/pilot/` peradresavimo nuoroda. Nedirba su SMTP raktais, naudotojų teisėmis ar duomenų baze; nesiunčia laiškų; nekelia API limitų.
- `tests/auth-config.test.mjs`: tikrina nuorodą, šablonus, idempotentiškumą, esamų peradresavimų išsaugojimą ir produkcinės svetainės URL apsaugą.
- `.github/workflows/gi-auth-config.yml`: PR tikrina **be jokios paslapties**, main patvirtintas atnaujinimas per `gi-auth-admin` GitHub Environment, ribotas `contents: read`. GitHub Actons aplinkai galima pridėti privalomą patvirtintoją.
- Skaidrumas: prieš PATCH įrankis daro GET, parodo tik laukų pavadinimus (ne SMTP slaptažodžius), siunčia tik **pasikeitusius** leidžiamus laukus, paskui daro GET ir patikrina. Jokių pilnų Auth config atsakymų į logus.

## Vienkartinis organizacijos administratoriaus darbas (paslaptys – tik valdymo skydeliuose)

### 1. Sukurti Supabase prieigos raktą
Atidarykite: https://supabase.com/dashboard/account/tokens

Jeigu leidžiama – sukurkite **fine-grained Management API token**, prieigą apribokite tik GI pilotui, su trumpa galiojimo data ir mažiausiomis būtinomis teisėmis: `auth_config_write` bei `project_admin_write` (kaip reikalauja Supabase API). Jei tokio granularumo / projekto apribojimo vartotojo aplinka neleidžia, **nesirinkite plataus scope automatiškai**; patvirtinkite alternatyvos rizikas. Pavadinimas: `GI-GitHub-Auth-Deploy`.

**Niekada** neklijuokite rakto į ChatGPT pokalbį, GitHub failą, Issue, PR, Google Drive ar laisvo teksto lauką.

### 2. GitHub Environment su patvirtinimu
Atidarykite: https://github.com/Giriu-inspekcija/giriu-inspekcija-app/settings/environments

- Sukurkite environment **`gi-auth-admin`**.
- `Deployment branches/tags`: leiskite **tik `main`**.
- `Required reviewers`: nurodykite organizacijos įgaliotą GitHub administratorių; jeigu vienas žmogus ir įjungtas `Prevent self-review`, nepavyks patvirtinti savo diegimo – pasirinkite pagal faktinę administratorių situaciją.
- `Environment secrets` → **New environment secret**: name **`SUPABASE_MANAGEMENT_TOKEN`**, value – tik Supabase valdymo skyde sukurtas raktas. Nenaudoti `anon`, `service_role` ar `Resend` API raktų – jie netinka šiam tikslui.
- Rekomenduojama atskirai apsaugoti GitHub `main` branch taisyklę – PR peržiūra, reikalaujamas CI, riboti tiesioginius push ir prieigas administratoriui.

### 3. Patvirtinti atskirą Auth PR
Šis automatizavimas sąmoningai kuriamas atskirame PR nuo nebaigtos `PR #5` savanorių sistemos. Peržiūrėkite ir sujunkite **tik po to**, kai sėkmingas CI ir įjungtos Environment apsaugos.

Po sujungimo `main` pakeitimai į Auth failus paleis GitHub workflow, kuris praeis Environment patvirtinimą ir tik tada atnaujins Supabase Auth. Ateityje: ChatGPT pakeičia šabloną → PR / patikros → įgaliotas asmuo sujungia → patvirtina diegimą. Įprastos naršyklės nereikia.

Jeigu automatinis paleidimas nepavyko arba buvo praleistas, atidarykite https://github.com/Giriu-inspekcija/giriu-inspekcija-app/actions/workflows/gi-auth-config.yml → Run workflow → main → įveskite `APPLY-GI-AUTH` → Run; patvirtinkite environment diegimą.

## Numatyta būtent GI pilotui
`Site URL` keičiamas iš `http://localhost:3000` arba seno PR peržiūros adreso į:
`https://starlit-shortbread-a38110.netlify.app/pilot/`

Į leidžiamus `Redirect URLs` įrašomi **abu** tikslūs adresai: pagrindinis `/pilot/` ir `https://deploy-preview-5--starlit-shortbread-a38110.netlify.app/pilot/`. Kiti esami adresai išsaugomi, jau nustatytas atskiras HTTPS produkcinis `Site URL` neperrašomas. 2026-11-23 pridėtos naujo Cloudflare domeno `https://komanda.giriuinspekcija.lt/pilot/` ir Pages peržiūros `https://giriu-inspekcija-app.pages.dev/pilot/` nuorodos. Netlify nuorodos išlieka kaip atsarginės. `Site URL` šiame etape NEKEIČIAMAS: keisti į nuolatinį domeną tik kai HTTPS sertifikatas aktyvus ir OAuth, el. pašto patvirtinimas bei slaptažodžio atkūrimas išbandyti. Jei GitHub Auth workflow negali pritaikyti PATCH (nėra tokeno ar apsaugotos aplinkos leidimo), Supabase Dashboard → Authentication → URL Configuration → Redirect URLs įtraukti abi nuorodas rankiniu būdu, senų neištrinti. Po to patikrinti login ir redirect realiame telefone.

**NB:** šis PR nenustato Netlify svetainės matomumo. Jei matote `This site is private`, savanoris negalės atidaryti peržiūros net po sėkmingo Auth diegimo. Tikro testavimo metu svetainė turi būti atvira, o privačius duomenis saugo Supabase Auth ir RLS.

## Būtina patikra po aktyvavimo
1. GitHub Actions `validate` bei `apply` = Success, o ne tik Deploy Preview.
2. Supabase Auth URL Configuration: ne `localhost:3000`, o leistinas GI adresas.
3. Supabase Email Templates: 3 lietuviški šablonai. Nekeisti `{{ .ConfirmationURL }}`.
4. Su **nauja** asmenine el. pašto dėžute registruotis bandomojoje PWA; `Resend → Emails` patikrinti laiško išsiuntimą/pristatymą, patvirtinimą, slaptažodžio sukūrimą, `pending` būseną.
5. Patikrinti tik su sintetinėmis užduotimis. Naujas naudotojas negali pats tapti Master/koordinatoriumi. Tik sintetinės užduotys: PR #5 sujungtas į main, bet tai dar nėra leidimas naudoti realias GI bylas ar nepatikrintas teises.
6. Jei registracija nesuveikia – tikrinti Supabase Auth logs + Resend delivery logs. **Nerodyti slapto rakto.**
7. Jei patvirtinimo nuoroda neveikia – galimas senas laiškas / pasibaigęs vienkartinis tokenas; naudoti naują laišką, nebandyti kartotinai per greitai.

## Šaltiniai
- https://supabase.com/docs/reference/api/v1-update-auth-service-config
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/redirect-urls
- https://docs.github.com/en/actions/reference/security/secure-use
