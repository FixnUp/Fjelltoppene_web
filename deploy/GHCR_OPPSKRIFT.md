# Deploy fra GitHub Container Registry

## Steg 1 — Push workflow-filen til repoet

På maskinen din lokalt:

```bash
git pull
git add .github/workflows/docker-publish.yml deploy/
git commit -m "Bygg og publiser Docker-image automatisk"
git push
```

## Steg 2 — Vent på første bygg

Gå til **github.com/FixnUp/Fjelltoppene_web/actions** og se at workflow-en kjører grønt. Tar ca. 1–2 minutter første gang.

Når den er ferdig:
- Gå til **github.com/FixnUp?tab=packages**
- Du skal nå se pakken `fjelltoppene-web`

## Steg 3 — Gjør imaget offentlig (viktig!)

GHCR-pakker er **private** som standard. TrueNAS får da en `denied` / `unauthorized`-feil når den prøver å hente.

1. Åpne pakken: **github.com/users/FixnUp/packages/container/fjelltoppene-web**
2. Høyre side → **Package settings**
3. Helt nederst: **Change visibility → Public → Confirm**

(Alternativt: behold som privat og konfigurer TrueNAS med GitHub Personal Access Token under «Image Pull Secret», men offentlig er enklere.)

## Steg 4 — Opprett Custom App i TrueNAS

**Apps → Discover Apps → Custom App:**

| Felt | Verdi |
|---|---|
| Application Name | `fjelltoppene-web` |
| Image Repository | `ghcr.io/fixnup/fjelltoppene-web` |
| Image Tag | `latest` |
| Image Pull Policy | `Always` |

**Network → Add Port:**
- Container Port: `80`
- Node Port: `30080`
- Protocol: `TCP`

**Restart Policy:** `Unless Stopped`

Trykk **Install**. TrueNAS henter imaget fra GitHub og starter containeren.

## Steg 5 — Logo i app-listen

I app-konfigurasjonen → **Icon URL**:
```
https://raw.githubusercontent.com/FixnUp/Fjelltoppene_web/main/assets/logo.svg
```

## Oppdatere siden senere

Bare push til GitHub:
```bash
git add .
git commit -m "Oppdater innhold"
git push
```

GitHub Actions bygger nytt image automatisk (~2 min). Deretter i TrueNAS:

**Apps → Installed → fjelltoppene-web → ⋮ → Pull Latest Image**

Eller via shell:
```bash
docker pull ghcr.io/fixnup/fjelltoppene-web:latest
docker restart $(docker ps --filter "name=fjelltoppene-web" -q)
```

---

## 🆘 Feilsøking

**`pull access denied` / `unauthorized`**
Pakken er fortsatt privat. Se Steg 3 over.

**Workflow feiler med `permission denied` ved push**
GitHub trenger Actions å ha pakke-skriverettigheter:
**Repo → Settings → Actions → General → Workflow permissions** → velg **Read and write permissions** → Save.

**Imaget oppdateres ikke i TrueNAS selv etter ny push**
TrueNAS cacher det gamle imaget. Sett **Image Pull Policy** til `Always`, eller kjør manuelt:
```bash
docker pull ghcr.io/fixnup/fjelltoppene-web:latest
```
