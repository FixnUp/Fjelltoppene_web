# Fjelltoppene.no — Deploy på TrueNAS Scale

Komplett oppskrift fra GitHub-repo til kjørende app, med eget ikon i app-listen.

> **Forutsetning:** TrueNAS Scale 24.10 (Electric Eel) eller nyere — disse versjonene bruker Docker direkte. Eldre versjoner (Bluefin/Cobia) bruker k3s og krever en annen fremgangsmåte.

---

## 🎯 Hva du ender opp med

- Nettsiden kjører på `http://<truenas-ip>:30080`
- Vises i **Apps → Installed** med Fjelltoppene-logoen
- Restartes automatisk hvis TrueNAS booter
- Oppdateres med én kommando når du pusher til GitHub

---

## Steg 1 — Klargjør datasett

Via TrueNAS-GUI:

1. **Datasets → SSD (eller poolen din) → Add Dataset**
2. **Name:** `web` (hvis du ikke allerede har det)
3. Under `web`: **Add Dataset** → Name: `fjelltoppene`

Endelig sti blir noe sånt som `/mnt/SSD/web/fjelltoppene`.

> Tilpass `SSD` til navnet på din pool. Resten av guiden bruker `/mnt/SSD/Web/fjelltoppene`.

---

## Steg 2 — Klon repoet

**System Settings → Shell** i TrueNAS:

```bash
cd /mnt/SSD/Web/fjelltoppene
git clone https://github.com/FixnUp/Fjelltoppene_web.git .
```

Verifiser:
```bash
ls
# index.html  logo.html  assets/  deploy/  ...
```

> Mangler `deploy/`-mappa? Sjekk at den ble pushet opp til GitHub. Hvis ikke, se «Hvis deploy/-mappa mangler» nederst.

---

## Steg 3 — Velg deploy-metode

### 🟢 Metode A — Volum-mount (anbefalt, enklest å oppdatere)

Ingen Docker-bygg nødvendig. Filene serveres direkte fra disken via standard nginx-image.

Gå rett til **Steg 4**.

### 🔵 Metode B — Egen Docker-image

Hvis du vil ha tunet nginx-config og bygd container:

```bash
cd /mnt/SSD/Web/fjelltoppene
docker build -t fjelltoppene-web:latest -f deploy/Dockerfile .
docker images | grep fjelltoppene   # bekreft at image finnes
```

---

## Steg 4 — Opprett Custom App

**Apps → Discover Apps → Custom App** (knapp øverst til høyre).

### Application Info
| Felt | Verdi |
|---|---|
| Application Name | `fjelltoppene-web` |
| Version | `1.0.0` |

### Container Images
| Felt | Metode A (volum) | Metode B (egenbygd) |
|---|---|---|
| Image Repository | `nginx` | `fjelltoppene-web` |
| Image Tag | `1.27-alpine` | `latest` |
| Image Pull Policy | `IfNotPresent` | `Never` ⚠️ |

> ⚠️ For Metode B er det viktig å sette `Never` (eller `IfNotPresent`) — ellers vil TrueNAS prøve å hente fra Docker Hub og feile.

### Network Configuration
- **Host Network:** ❌ av
- **Port Forwarding → Add:**
  - Container Port: `80`
  - Node Port: `30080`
  - Protocol: `TCP`

### Storage Configuration (kun Metode A)
**Add → Host Path Volume:**
- Host Path: `/mnt/SSD/Web/fjelltoppene`
- Mount Path: `/usr/share/nginx/html`
- Read Only: ✅

### Resources Configuration
- CPU: `2.0`
- Memory: `512` MiB

### Restart Policy
- `Unless Stopped`

Trykk **Install**. Vent ~30 sekunder til status blir **Running**.

Test: `http://<truenas-ip>:30080`

---

## Steg 5 — Få Fjelltoppene-logoen til å vises i app-listen

TrueNAS Custom Apps bruker et standard kassergrått ikon i listen. Slik bytter du det med din egen logo:

### Gjør logoen offentlig tilgjengelig via GitHub

Logoen ligger allerede i repoet ditt på `assets/logo.svg`. GitHub har en gratis CDN for repo-filer:

```
https://raw.githubusercontent.com/FixnUp/Fjelltoppene_web/main/assets/logo.svg
```

Test URL-en i nettleseren — du skal se logoen. (Bytt `main` til `master` om grenen heter det.)

### Sett ikonet på appen

1. **Apps → Installed → fjelltoppene-web → Edit**
2. Bla helt opp til **Application Info**
3. Finn feltet **Icon URL** (kan også hete *Icon Repository* eller ligge under *Custom App settings* avhengig av versjon)
4. Lim inn URL-en over
5. **Save**

Refresh siden — logoen vises nå på app-kortet.

> 💡 SVG fungerer best — skarpt på alle skjermstørrelser. Hvis Custom App-skjemaet ditt ikke godtar SVG, kommiter en PNG-versjon (`assets/logo-512.png`, 512×512) og bruk den i stedet.

---

## Steg 6 — Oppdatere siden senere

Når du har pushet endringer til GitHub:

```bash
cd /mnt/SSD/Web/fjelltoppene
git pull
```

**Metode A:** ferdig — nginx serverer de nye filene umiddelbart. Eventuelt:
```bash
# Tøm nginx-cache hvis du ser gamle filer:
docker restart $(docker ps --filter "name=fjelltoppene-web" -q)
```

**Metode B:**
```bash
docker build -t fjelltoppene-web:latest -f deploy/Dockerfile .
docker restart $(docker ps --filter "name=fjelltoppene-web" -q)
```

---

## Steg 7 — (Valgfritt) Eksponer på fjelltoppene.no med SSL

Du trenger en reverse proxy og et Let's Encrypt-sertifikat. Enkleste vei på TrueNAS:

### Installer Nginx Proxy Manager

1. **Apps → Discover Apps → søk «Nginx Proxy Manager» → Install**
2. Standardporter: 30021 (admin), 30080 (HTTP), 30443 (HTTPS)
3. **VIKTIG:** Endre porten på fjelltoppene-appen din først hvis den allerede bruker 30080. Bytt til f.eks. `30081`.

### Sett opp i ruteren / brannmur

- Portforward `80 → TrueNAS:30080` og `443 → TrueNAS:30443`
- DNS: A-record for `fjelltoppene.no` og `www.fjelltoppene.no` → din offentlige IP

### Konfigurer i Nginx Proxy Manager

Åpne `http://<truenas-ip>:30021` (login `admin@example.com` / `changeme` første gang).

1. **Hosts → Proxy Hosts → Add Proxy Host**
2. **Details-fanen:**
   - Domain Names: `fjelltoppene.no`, `www.fjelltoppene.no`
   - Scheme: `http`
   - Forward Hostname / IP: `<truenas-ip>`
   - Forward Port: `30081` (den nye porten på fjelltoppene-appen)
   - Block Common Exploits: ✅
   - Websockets Support: ✅
3. **SSL-fanen:**
   - SSL Certificate: *Request a new SSL Certificate*
   - Force SSL: ✅
   - HTTP/2 Support: ✅
   - Agree to Let's Encrypt ToS: ✅
4. **Save**

NPM henter sertifikatet automatisk innen ~30 sekunder. Test på `https://fjelltoppene.no`.

---

## 🆘 Feilsøking

**Appen starter ikke / Status: Crashed**
```bash
docker logs $(docker ps -a --filter "name=fjelltoppene-web" -q)
```

**`ERROR: failed to build: resolve : lstat deploy: no such file or directory`**
`deploy/`-mappa er ikke pushet til GitHub. Push den fra maskinen der originalfilene ligger, eller bruk Metode A (volum-mount) som ikke krever den.

**Tom hvit side / 403 Forbidden**
Sjekk at `index.html` ligger direkte i `/mnt/SSD/Web/fjelltoppene/` (ikke i en undermappe):
```bash
ls /mnt/SSD/Web/fjelltoppene/index.html
```

**Får ikke endret ikon**
TrueNAS cacher ikonet aggressivt. Hard refresh nettleseren (Ctrl+Shift+R), eller endre URL-en (legg på `?v=2` på slutten).

**Bilder vises ikke**
Sjekk at `assets/`-mappa ble med:
```bash
ls /mnt/SSD/Web/fjelltoppene/assets/
```

---

## Hvis deploy/-mappa mangler i GitHub-repoet

Kjør dette på TrueNAS for å lage de nødvendige filene:

```bash
cd /mnt/SSD/Web/fjelltoppene
mkdir -p deploy

cat > deploy/Dockerfile <<'EOF'
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY logo.html  /usr/share/nginx/html/
COPY assets/    /usr/share/nginx/html/assets/
EXPOSE 80
EOF

cat > deploy/nginx.conf <<'EOF'
server {
  listen 80 default_server;
  root /usr/share/nginx/html;
  index index.html;
  gzip on;
  gzip_types text/css application/javascript image/svg+xml;
  location /assets/ { expires 30d; try_files $uri =404; }
  location / { try_files $uri $uri/ /index.html; }
  add_header X-Content-Type-Options "nosniff" always;
  server_tokens off;
}
EOF
```

Push tilbake til repoet for fremtidig bruk:
```bash
git add deploy/
git commit -m "Legg til TrueNAS deploy-filer"
git push
```
