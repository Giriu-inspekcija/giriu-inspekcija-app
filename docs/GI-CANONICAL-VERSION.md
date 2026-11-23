# GI komanda – vienintelė toliau vystoma versija

> **Kanoninis sprendimas nuo 2026-11-23:** „GI komanda“, Cloudflare Pages + Supabase, testinis savanorių pilotas. Pradinė migracijos bazė: GitHub commit `4a5039164762833098ef96be1b383885eefaff21`. Tai atskaitos taškas, **ne užšaldytas kodas**.

## Vienas adresas ir viena tiesa
- **Vienintelis savanoriams skirtas adresas:** https://komanda.giriuinspekcija.lt/pilot/
- `https://komanda.giriuinspekcija.lt/` automatiškai nukreipia į `/pilot/`. Šakninė lokali DEMO programėlė nėra tikroji GI sistema.
- **Hostingas:** Cloudflare Pages, projektas `giriu-inspekcija-app`; papildoma `https://giriu-inspekcija-app.pages.dev/pilot/` nuoroda skirta tik testavimui.
- **Vienintelis kodo šaltinis:** https://github.com/Giriu-inspekcija/giriu-inspekcija-app, pagrindinė šaka `main`; versijos keičiamos per PR ir CI.
- **Build:** `npm run build:pages`, viešas katalogas `dist` (griežtas leidžiamų failų sąrašas).
- **Duomenys, Auth ir privatūs failai:** Supabase projekto `mkhxokzuietqgjdpkcqq` (neperkelti į Cloudflare).
- **Netlify:** ankstesnė atsarginė aplinka; nebelaikyti pagrindine, savanorių ten nebesiųsti, nieko neatjungti, kol patvirtinti visi migracijos žingsniai.
- **PR #35:** izoliuota realių bylų schema ruošiama atskirai; neužbaigta / negalima laikyti leidimu naudoti tikrus gyventojų duomenis.

## Ką keisti kuriant naują funkciją
- `pilot/index.html` – tikros programėlės vaizdas ir mobilus UX.
- `pilot/app.js` – darbai, laikas, pranešimai, dokumentai, vartotojų veiksmai.
- `pilot/team-thread.js` – darbo / įvykio kortelė, įrašai, dokumentų ir nuotraukų priedai.
- `pilot/sw.js` ir `pilot/manifest.webmanifest` – PWA ir versijos atnaujinimai.
- `supabase/migrations/` – tik per patikrintas, mažiausių teisių migracijas (RLS privalomas).
- `scripts/build-pages.mjs` – public output allowlist; nepateikti `.github`, `docs`, `supabase`, `scripts` ar slaptų duomenų.
- `index.html` šaknyje yra **senas vietinis DEMO**. Jo netobulinti kaip pagrindinės programėlės. `dist/index.html` generuojamas kaip nukreipimas į `/pilot/`.

## Priėmimo tvarka
1. Surinkti / susisteminti registruotas naudotojų pastabas `public.gi_feedback` ir `public.gi_feedback_review`; netrinti originalų.
2. Maži pataisymai → atskira GitHub šaka ir PR, testai → `main` → automatinis Cloudflare Pages diegimas.
3. Patikrinti **GitHub static-checks** ir **Cloudflare Pages** statusus = Success, o ne vien PR sukūrimą.
4. Patikrinti realiu telefonu `/pilot/`: prisijungimas, užduoties kūrimas, peržiūra, pranešimo pateikimas, PWA atnaujinimas. Testams – tik sintetiniai duomenys.
5. Tik po peržiūros pažymėti pastabą išspręsta `gi_feedback_review`; automatinis AI negali pats tyliai įjungti tikrų bylų, keisti teisių ar publikuoti nepatikrinto kodo.
6. Didesni pakeitimai (dokumentų ruošimas iš Drive, realios bylos, Push) reikalauja aiškaus projekto / privatumo sprendimo ir atskirų testų.

## Pastabų automatikos ribos
- `pg_cron` kas 15 min. surenka pastabų eilę, esami ChatGPT periodiniai darbai gali jas peržiūrėti ir siūlyti pataisas.
- **Nėra automatinės teisės be peržiūros keisti produkcinę sistemą, duomenų bazės teises ar siųsti raštus.** Ne kurti dublikuotų automatizacijų.
- Kaštai: Cloudflare Free kol pakanka statinių kūrimų, Supabase Free kol pakanka bazės/Storage/Auth, GitHub esamas planas. Prieš mokamus išteklius – atskiras sprendimas.

## Ką tikrinti po kiekvieno svarbaus atnaujinimo
- `https://komanda.giriuinspekcija.lt/` → `/pilot/`, jokios vietinės DEMO versijos.
- Nepermeta po prisijungimo į `netlify.app`.
- PWA iOS/Android atsinaujina (versijos keitimas `pilot/sw.js`).
- Tikri asmens duomenys ir realios bylos **dar neleidžiami**, kol užbaigtos RLS/Storage, atsarginės kopijos ir privatumo patikros.

## 2026-11-23 – Gmail veiksmų pasiūlymų bandymas

Gautų organizacijos Gmail pranešimų santraukos peržiūrėtos prisijungus per Gmail. **Sukurti 9 idempotentiški bandomieji `agent:gmail/<message-id>` pasiūlymai `public.gi_tasks`**, `status=proposed`, `is_demo=true`, neskiriant vykdytojų ir neviešinant priedų. Šaltinio el. pašto nuoroda GI koordinatoriaus pasiūlymo kortelėje atidaroma tik esant teisei skaityti organizacijos Gmail. Šaltinio laiško kopija, PDF ir ADOC nepatenka į Supabase.

Pasiūlymus reikia peržiūrėti ir tik tada patvirtinti į užduočių fondą. Iki tikrų bylų modulio ir jo RLS/privacy patikros šių įrašų negalima laikyti tikromis bylomis ar siųsti institucijoms. Jau egzistuojančio LTSA siuntimo užduoties nedubliuoti: papildomas pasiūlymas yra tik gauto LTSA atsakymo peržiūra. Teismo nutarties priedai neperkelti. Nebuvo automatinių Gmail siuntimų, mokėjimų ar savanorių paskyrimų.

UI patobulintas: `+ Pridėti laiką`, 15/30/60/120 min. įvedimo parinktys, atskirai sutraukti ankstesni laiko įrašai ir koordinatoriaus peržiūra, kandidatų teisės paslėptos po papildomais nustatymais, Gmail pasiūlymai rodomi sutraukiamame bloke.

Toliau: saugus tikrų atvejų susiejimas su Gmail / Drive, kai būsimas realių bylų modulis turės tikslinį RLS ir naudotojų teises; atskiras procesas. 
