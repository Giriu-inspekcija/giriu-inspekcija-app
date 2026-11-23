# GI komanda – saugus perėjimas į Cloudflare Pages

**Tvarka:** Cloudflare pirmiausia, PR #35 vėliau. Šiame PR jokios veikiančios Supabase, DNS ar Netlify konfigūracijos nekeisti.

## Sukurti Cloudflare paskyrą
- Registruoti atskirą Cloudflare paskyrą organizacijos valdoma el. pašto dėžute **info@giriuinspekcija.lt**.
- Paskyros vardas: **Girių inspekcija**; įjungti MFA ir saugiai išsaugoti atkūrimo kodus.
- Po patvirtinimo kviesti atskirą administratorių kaip paskyros narį. Nenaudoti bendro slaptažodžio dalijimosi.
- Kol kas **NEKEISTI** giriuinspekcija.lt nameserverių ar DNS. Naudoti tik Cloudflare suteiktą *.pages.dev adresą.

## GitHub prieiga
1. Cloudflare dashboard → **Workers & Pages** → **Create application → Pages → Connect to Git**.
2. GitHub prijungti su ta paskyra, kuriai suteiktos teisės valdyti dabartinę saugyklą.
3. Cloudflare GitHub App suteikti **Only select repositories** tik **Giriu-inspekcija/giriu-inspekcija-app** (ne All repositories).
4. **Production branch: main**. PR #35 lieka atskirai ir niekada neturi būti sujungtas vien dėl Cloudflare migracijos.

## Build nustatymai
- **Framework preset:** None / No framework
- **Root directory:** repository root (palikti tuščią arba /)
- **Build command:** `npm run build:pages`
- **Build output directory:** `dist`
- **Node.js:** 20+ (projekto package.json nurodyta >=20).
- **Project name:** `gi-komanda-pilotas` (jei prieinamas) – skirtas bandomajam adresui.
- **Jokių Supabase service_role, duomenų bazės slaptažodžių ar API secret į Cloudflare kintamuosius.** Naršyklėje tinka tik esamas viešas Supabase publishable raktas.
- NEPASIRINKTI `/` kaip build output directory: šaknyje yra `supabase/migrations`, `scripts`, `docs`, `.github`, kurie nepriklauso viešai svetainei.

## Funkcinis bandymas
1. Atverti Pages URL, patikrinti `/`, `/pilot/`, `/pilot/privatumas.html`, favicon, manifest, PWA, service worker.
2. Patikrinti, kad `/supabase/migrations/`, `/scripts/`, `/docs/`, `/tests/`, `/.github/` nieko negrąžina (nebus 200 su dokumentų turiniu).
3. Supabase Dashboard → Authentication → URL Configuration pridėti Pages bazinio URL `https://<project>.pages.dev/**` prie **Redirect URLs**. **Nekeisti** pagrindinio Site URL iš karto.
4. Jei Google OAuth, patikrinti autorizavimo srautą. Supabase callback adresas Google Cloud pusėje paprastai lieka `https://mkhxokzuietqgjdpkcqq.supabase.co/auth/v1/callback` – neveikiančių redirectų nekeisti aklai.
5. Bandymuose naudoti tik sintetinius duomenis. Patikrinti login, signup, el. pašto patvirtinimą, password reset, užduotis, valandas, įvykius, nuotraukas, koordinatoriaus teises.
6. Mobiliai patikrinti iOS Safari ir Android Chrome įdiegimą į pradžios ekraną, atsijungimą/prisijungimą, PWA atnaujinimą, galimą offline shell.
7. Netlify palikti kaip veikiantį atsarginį adresą iki patvirtintos perėjimo dienos.

## Išleidimas ir atstatymas
- Iki bandymų pabaigos savanoriams nekeisti pagrindinės nuorodos.
- Pakeitimų į Cloudflare įvykdymas nedaro SQL migracijos, nekeičia duomenų, Netlify ir DNS.
- Jei kas nors neveikia Cloudflare, naudoti seną Netlify adresą, ištirti klaidą atskiroje GitHub šakoje ir tik tuomet kartoti.
- Tik po Cloudflare stabilizavimo peržiūrėti PR #35. Jo sujungimas nereiškia leidimo talpinti tikrų bylų duomenis.

## Kodėl atskiras dist/
`npm run build:pages` paleidžia `scripts/build-pages.mjs`, kuris kopijuoja tik viešai leistinus statinius failus. Į `dist/` nepatenka testai, GitHub workflows, migracijos ir atsarginių kopijų scenarijai.
