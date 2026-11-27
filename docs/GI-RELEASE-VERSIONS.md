# GI programėlės versijų tvarka

Nuo 2026-11-27: v3.3.0 (ankstesnė v32 žyma; 3.3.0 apima naują ALF projektų priskyrimą). Vienintelis leidimo numerio šaltinis – package.json version; atnaujinti ir šaltinio pilot/index.html bei pilot/sw.js atsarginę žymą tame pačiame PR. PATCH (3.2.1) – klaidos / UX pataisos; MINOR (3.3.0) – naujas funkcionalumas; MAJOR (4.0.0) – esminė nesuderinama architektūros ar darbo eigos kaita. Tai leidimų numeriai, ne pažadas apie būsimų leidimų apimtį.

Cloudflare build-pages.mjs automatiškai įrašo vX.Y.Z · trumpą CF_PAGES_COMMIT_SHA į matomą antraštę ir atskirą PWA cache vardą. Jei commit ID nėra, naudojamas deterministinis viešų failų SHA256 trumpinys. Kiekvienas naujas commit turi skirtingą build ID net jei versijos numeris nepakeltas. Produkcijos patikroje lyginti matomą ID su GitHub main commit; senoji žyma telefone reiškia, kad reikia patikrinti diegimą arba PWA atnaujinimą. Asmens duomenys ir autentifikuoti atsakymai nekaupiami PWA cache.

Prieš diegimą – PR testai; po diegimo – patikrinti matomą versiją ir pagrindinius telefono veiksmus. Nekeisti DB ar prieigų vien dėl numeravimo.


## Savarankiškas pataisų užbaigimas

2026-11-27 vadovo nurodymas: aptikus aiškią CI/testo klaidą, nelaukti papildomo nurodymo. Perskaityti nesėkmės žurnalą, nustatyti priežastį, pataisyti kodą arba tikrai pasenusią testo prielaidą, išsaugoti esamas saugumo ir funkcines garantijas, paleisti patikras naujausiam commit. Testų neišjungti, neslėpti gedimų ir nenaudoti priverstinio merge. Kai aktualios patikros sėkmingos ir pakeitimas patenka į jau suteiktą leidimą, sujungti į main, patikrinti realų viešą diegimą, uždaryti pakeistus PR su nuorodomis. Jei patikros dar nebaigtos ar reikalingas atskiras saugumo, mokėjimo, prieigų arba duomenų keitimo sprendimas, tiksliai įvardyti likutį; nežadėti foninio darbo. Realių bylų saugumo vartų neapeiti.
