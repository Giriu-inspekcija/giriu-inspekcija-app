GIRIŲ INSPEKCIJA – GI KOMANDA | VIENINTELĖ TOBULINAMA CLOUDFLARE VERSIJA
Būsena nuo 2026-11-23

SVARBIAUSIOS NUORODOS
- Tikroji bandomoji savanorių darbo vieta: https://komanda.giriuinspekcija.lt/pilot/
- Trumpasis adresas: https://komanda.giriuinspekcija.lt/ (nukreipia į /pilot/)
- GitHub kodo šaltinis: https://github.com/Giriu-inspekcija/giriu-inspekcija-app
- Vystymo šaka: main; naujos funkcijos tik per patikrintus PR.
- Cloudflare Pages projektas: giriu-inspekcija-app, automatiškai publikuojamas iš main.
- Supabase (Auth / duomenų bazė / Storage): mkhxokzuietqgjdpkcqq.

SVARBU PROGRAMUOTOJAMS IR AI AGENTAMS
1. Pagrindinė programėlė yra pilot/index.html, pilot/app.js, pilot/team-thread.js ir pilot/sw.js.
2. Šakninis index.html yra senoji lokalios demonstracijos versija. Jo nelaikyti realia GI komanda, jo netobulinti kaip pagrindinio produkto.
3. Cloudflare build komanda npm run build:pages generuoja dist/ tik su leistinais viešais failais; dist/index.html nukreipia į /pilot/.
4. Netlify yra paliktas atsargai, tačiau neturi būti naudojamas kaip kanoninis adresas.
5. Visi bandomieji atvejai yra sintetiniai. Tikrų bylų ir asmens duomenų naudoti negalima iki atskiro saugumo patvirtinimo.
6. Pakeitimų ciklas: nauja pastaba -> GitHub PR -> testai -> main -> Cloudflare Pages auto-deploy -> telefono patikra.
7. Neišsaugokite slaptų raktų ar asmens duomenų public GitHub.

IŠSAMIAI
- docs/GI-CANONICAL-VERSION.md – architektūra ir priėmimo kriterijai.
- docs/GI-FEEDBACK-TRIAGE-20261123.md – užfiksuotos 11 naudotojo pastabų ir darbų skirstymas.
- docs/GI-BACKUP-RESTORE.md – šifruotos atsarginės kopijos ir atkūrimas.
- docs/CLOUDFLARE-PAGES-MIGRATION.md – istorinis pradinės migracijos planas, ne dabartinė operacinė instrukcija.
