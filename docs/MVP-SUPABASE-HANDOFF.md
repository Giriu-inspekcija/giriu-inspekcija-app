# GI PWA: vykdymo perdavimas Work / Codex (2026-11-22)

**Statusas:** šiame PR tik parengta migracija ir *statiniai* testai. Supabase projekto šiuo ChatGPT pokalbiu pasiekti nepavyko, todėl DB nekurta, migracija neįvykdyta, naudotojai neregistruoti. Esamas Netlify demo išlieka atskiras ir veikiantis. Nepainioti šios parengties su paleistu daugiavartotojišku pilotu.

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
