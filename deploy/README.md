# Driftsoppsett (Railway)

Nettsiden kjører som én tjeneste på Railway, bygget fra `deploy/Dockerfile`.

| Variabel | Beskrivelse |
|---|---|
| `ADMIN_PASSWORD` | **Påkrevd** for admin (minst 8 tegn). Uten den er admin avslått. |
| `ADMIN_USER` | Brukernavn, standard `admin`. |
| `SESSION_SECRET` | Lang tilfeldig streng som signerer innloggingen. Uten den må alle logge inn på nytt etter hver deploy. |
| `PORT` | Settes til `80` (domenet peker på port 80). |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/Dockerfile` |

Redigert innhold og opplastede bilder ligger på et Railway-volum montert på `/data`
(`content.json`, `uploads/`, `backups/`). Uten volum forsvinner endringene ved neste deploy.

Bytte passord: endre `ADMIN_PASSWORD` i Railway. Tjenesten starter på nytt, og alle blir logget ut.

Kjøre lokalt:

```bash
cd server && npm ci
ADMIN_PASSWORD=hemmelig123 SESSION_SECRET=x DATA_DIR=../.data node server.js
# http://localhost:3000  ·  admin på /admin
```

## Hvordan redigering fungerer

Elementer i HTML-filene som skal kunne redigeres har attributter:

- `data-cms="side.seksjon.nøkkel"` for tekst (fet, kursiv og lenker tillatt)
- `data-cms-img="…"` for bilder
- `data-cms-href="…"` for knappelenker
- `data-cms-list="…"` for lister der elementer kan legges til, flyttes og slettes (FAQ, skjermbilder, nyheter)

Nøklene er faste. Gi nye elementer nye, unike nøkler for hånd. Ikke bruk nøkler på nytt for annet innhold.

## Innsendte bilder og Instagram

Besøkende kan sende inn bilder på `/send-inn`. Et bilde går gjennom disse stegene:
bildet renses for metadata og skaleres, Claude vurderer det, og reglene i `server/lib/moderation.js` avgjør
om det **godkjennes** (legges i Instagram-køen), **holdes igjen** (venter i admin) eller **avvises**.
Alt AI-en er usikker på, og alle bilder der barn kan være synlige, går til admin. Innsendinger vises på
`/admin/innsendinger`, hvor du også finner nødbremsen.

| Variabel | Beskrivelse |
|---|---|
| `ANTHROPIC_API_KEY` | Nøkkel til Claude. Uten den går alle bilder til manuell godkjenning. |
| `MODERATION_MODEL` | Modell for vurderingen. Standard `claude-opus-5-5`. |
| `INSTAGRAM_MODE` | `off` (standard: godkjente bilder venter), `dry` (testkjøring, publiserer ikke), `live` (publiserer på ekte). |
| `IG_USER_ID` | Instagram-bruker-ID for Business/Creator-kontoen. |
| `IG_ACCESS_TOKEN` | Langlevd tilgangstoken. Serveren fornyer den selv og lagrer den nye på volumet. |
| `PUBLIC_BASE_URL` | Nettsidens offentlige adresse, f.eks. `https://fjelltoppene.no`. Instagram henter bildene derfra. |
| `IG_MAX_PER_DAY` | Maks antall innlegg per døgn (standard 3). |
| `IG_MIN_HOURS` | Minste antall timer mellom innlegg (standard 4). |
| `IG_API_BASE`, `IG_API_VERSION` | Valgfritt. Standard er `https://graph.instagram.com` uten versjon. |

Sikkerhet og personvern: bildets EXIF og GPS fjernes ved innsending, IP-adressen lagres bare som en uleselig kode,
avviste og tilbaketrukne innsendinger slettes etter 30 dager, og bildefilen for publiserte slettes etter 30 dager
(samtykkeposten beholdes). Instagram-API-et kan ikke slette innlegg, så fjerning gjøres manuelt i Instagram.
