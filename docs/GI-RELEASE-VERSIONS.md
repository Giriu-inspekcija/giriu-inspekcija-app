# GI programėlės versijų tvarka

Nuo 2026-11-27: v3.2.0 (ankstesnė v32 žyma). Vienintelis leidimo numerio šaltinis – package.json version; atnaujinti ir šaltinio pilot/index.html bei pilot/sw.js atsarginę žymą tame pačiame PR. PATCH (3.2.1) – klaidos / UX pataisos; MINOR (3.3.0) – naujas funkcionalumas; MAJOR (4.0.0) – esminė nesuderinama architektūros ar darbo eigos kaita. Tai leidimų numeriai, ne pažadas apie būsimų leidimų apimtį.

Cloudflare build-pages.mjs automatiškai įrašo vX.Y.Z · trumpą CF_PAGES_COMMIT_SHA į matomą antraštę ir atskirą PWA cache vardą. Jei commit ID nėra, naudojamas deterministinis viešų failų SHA256 trumpinys. Kiekvienas naujas commit turi skirtingą build ID net jei versijos numeris nepakeltas. Produkcijos patikroje lyginti matomą ID su GitHub main commit; senoji žyma telefone reiškia, kad reikia patikrinti diegimą arba PWA atnaujinimą. Asmens duomenys ir autentifikuoti atsakymai nekaupiami PWA cache.

Prieš diegimą – PR testai; po diegimo – patikrinti matomą versiją ir pagrindinius telefono veiksmus. Nekeisti DB ar prieigų vien dėl numeravimo.
