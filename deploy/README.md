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
