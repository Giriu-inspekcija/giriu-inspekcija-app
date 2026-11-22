# GI PWA: vykdymo perdavimas Work / Codex (2026-11-22)

**Statusas (2026-11-22):** Supabase prijungtas, nemokamas testinis projektas **`mkhxokzuietqgjdpkcqq`** (`eu-central-1`) sukurtas. DB migracijos `gi_synthetic_pilot_initial` ir `gi_synthetic_feedback` sėkmingai pritaikytos. Sukurtos 6 lentelės su RLS ir 3 sintetinės pool užduotys. Netlify peržiūros aplinka (GitHub PR #5) su realios autentifikacijos UI: https://deploy-preview-5--starlit-shortbread-a38110.netlify.app/pilot/ . **Dar nepatikrinta fiziniame telefone / su realiais kelių naudotojų prisijungimais; neviešinti kaip baigto piloto.** Pagrindinis Netlify demo išlieka nepakeistas.

## Tikslas
Turime PWA pavadinimu „Girių inspekcija“. Norime asmeninių savanorių paskyrų ir bendro užduočių fondo su koordinatoriaus patvirtinimu. Jokio naujo Google Workspace pašto savanoriui. Visi bandomieji duomenys sintetiniai.

## Jau padaryta
- Github saugykla: https://github.com/Giriu-inspekcija/giriu-inspekcija-app
- Oficiali PWA demonstracija: https://starlit-shortbread-a38110.netlify.app/
- Šiame PR įdėta `supabase/migrations/20261122154000_gi_synthetic_pilot.sql`: gi_ prefikso lentelės, RLS, pending/volunteer/coordinator/admin, backend RPC ir audito įrašai.
- `npm test` tikrina tik SQL sutarties statinius invariantus – **ne duomenų bazės funkcijų teises**.

## Neatlikta
1. Patikrinti, kad konkreti Supabase paskyra tikrai valdoma ir skirtas **atskiras testinis projektas**; nemigruoti tikros organizacijos duomenų.
2. Paleisti SQL migraciją su Supabase CLI po peržiūros ir atstatymo plano; atlikti realius RLS testus su 3 paskyromis.
3. Įjungti Google OAuth arba kitą saugų prisijungimą; teisėmis valdo DB, ne frontend vaidmenų selektorius.
4. Pirmą admin nustatyti rankiniu būdu **tik** tada, kai žinomas konkretus patvirtintas `auth.users.id`; ne kurti automatinės administratoriaus registracijos.
5. PWA sąsają prijungti prie Supabase REST/RPC ir Auth; jokio `service_role` ar slapto API rakto public JS/HTML. URL ir publishable key yra kliento konfigūracija.
6. Koordinatoriaus ekranas: pool, propose, publish, assign, review; savanoris: own tasks, accept, start, submit, time log.
7. ChatGPT -> pool **tik proposal**: pradėti nuo JSON importo su koordinatoriaus patvirtinimu, nenaudoti GitHub/Netlify klientinių paslapčių.
8. Dabartinį demo laikyti kaip atskirą `/demo` arba už saugios demonstracijos jungiklio; prieš pakeičiant viešą Netlify versiją patikrinti, kad anoniminiai svečiai nieko nemato.
9. Patikrinti Netlify preview ir mobilius scenarijus; neskirti tikrų savanorių be admin patvirtinimo.

## Privalomi realūs Supabase testai
- `pending` negali SELECT gi_tasks, gi_profiles (kitų) ar EXECUTE asignavimo/role funkcijų.
- `volunteer A` mato tik A paskirtas užduotis, `volunteer B` nemato A darbų.
- `coordinator` mato pool ir gali skirstyti; `volunteer` negali.
- Neautentifikuotas negali keisti statuso, importuoti ar rašyti laiko.
- Neleistinos būsenų perėjimo operacijos atmetamos.
- Pakartotas source_ref nesukuria dublikatų.
- Role pakeitimas rašomas `gi_role_events`; neįmanomas įprastam vartotojui.
- Du telefonai: koordinatoriaus paskyrimas matomas savanoriui po sinchronizacijos; kito savanorio duomenys izoliuoti.
- Login callback, iOS/Android, offline kompromisai. Offline įrašams būtinas konflikto sprendimas (nežadėti, kol neištestuota).
- Patikrinti, kad browser console ir GitHub įrašai neturi asmens duomenų ar raktų.

## Rankiniai vadovo sprendimai
Tik: pasirinkti tikslų Supabase testinį projektą, patvirtinti pirmojo admin tapatybę, patvirtinti OAuth teises ir realaus piloto publikavimą. Jokio mokamo plano ar API kreditų pirkimo be patvirtinimo.

## Nauja patikrinta informacija
- Supabase projektas: `giriu-inspekcija-pilotas` (planas Free, regionas eu-central-1).
- Supabase API: `https://mkhxokzuietqgjdpkcqq.supabase.co` (public URL, secret/service_role kodo saugykloje nėra).
- Įvykdytos migracijos: `gi_synthetic_pilot_initial`, `gi_synthetic_feedback`.
- Sintetinės užduotys: `SYNTH-001`, `SYNTH-002`, `SYNTH-003` (visos pool).
- `pilot/index.html` ir `pilot/app.js` naudoja atskirą Supabase aplinką, neperrašo pagrindinio `index.html`. Vieša publishable key klientui leidžiama, RLS būtina.
- `pilot` turi registraciją el. paštu, pending laukimą, koordinatoriaus pool/paskyrimus/rezultatų tvirtinimą, darbo laiką ir pastabų bazę.
- GitHub Actions: statiniai SQL testai + `node --check pilot/app.js`; sėkminga. Šis testas **neįrodo veikiančio autentifikavimo per naršyklę**.
- Tikrinant Supabase atmesti anonimo skaitymas, nepatvirtinto naudotojo kūrimas/paskyrimai/role grant ir non-demo įrašai.
- Supabase Security Advisor įspėja dėl 5 viešų `SECURITY DEFINER` RPC. Tai projektuota su rolės tikrinimu kiekvienoje funkcijoje; prieš tikrus duomenis būtinas papildomas profesionalus teisių auditas (linter WARN nėra savaiminis leidimas naudoti tikrus duomenis).
- Kol kas `auth.users` paskyrų / `gi_profiles` yra 0. Pirmasis administratorius dar nepatvirtintas, naujų savanorių prisijungimai dar neišbandyti.

## Likę kritiniai veiksmai
1. Supabase Authentication → URL Configuration: įrašyti tikslų Site URL ir leistinus Redirect URLs, įskaitant patvirtintą Netlify preview ir planuojamą `/pilot/` pagrindiniame domene. Tai atlikti per administravimo UI (šio Supabase įrankio nėra).
2. Patikrinti el. pašto slaptažodžio autentifikaciją; nemokamo SMTP ribas. Didesniam savanorių testui sukonfigūruoti Google OAuth – su organizacijai valdomomis Google Cloud OAuth teisėmis.
3. GI vadovas turi patvirtinti, koks **konkretus ir el. paštu patvirtintas** `auth.users.id` bus pirmasis admin. Tik tada vienkartiniu SQL pakelti jo `gi_profiles.role` į `admin`, netaikant saviregistracijos išimčių.
4. Atlikti realius RLS ir RPC bandymus su vienu admin, vienu koordinatoriumi ir dviem savanoriais skirtinguose naršyklių kontekstuose. Neužtenka statinių CI testų.
5. Patikrinti frontend CDN bibliotekos įkėlimą, login redirect, slaptažodžio srautą, valdymą telefone ir login session atnaujinimą.
6. Tik po patvirtinimo ir realių testų iškelti `/pilot/` į pagrindinį Netlify `main`, nepažeidžiant senojo demo ir aiškiai atskyrus pilotą nuo produkcijos.
7. Vėliau įdiegti DI JSON pasiūlymų importo patvirtinimą bei apsaugotą API. Kol kas automatinės ChatGPT užduočių sinchronizacijos nėra.
