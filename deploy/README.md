# Fjelltoppene.no — Deploy til TrueNAS Scale

Liten nginx-container som serverer statiske filer. Total image-størrelse: ~7 MB.

## Filstruktur

```
fjelltoppene/
├── index.html
├── logo.html
├── assets/
│   ├── logo.svg
│   ├── logo-mark.svg
│   ├── screen-map.jpg
│   ├── screen-lists.jpg
│   ├── screen-wishlist.jpg
│   ├── screen-activity.jpg
│   └── screen-profile.jpg
└── deploy/
    ├── Dockerfile
    ├── docker-compose.yml
    └── nginx.conf
```

---

## Alternativ 1 — Custom App via TrueNAS GUI (anbefalt)

### Steg 1 — Last opp filene til TrueNAS

1. SSH til TrueNAS, eller bruk **System → Shell**
2. Lag et datasett for appen, f.eks. `tank/apps/fjelltoppene`
3. Last opp hele prosjektmappa (SMB/SFTP/SCP):
   ```bash
   scp -r fjelltoppene/ admin@<truenas-ip>:/mnt/tank/apps/
   ```

### Steg 2 — Bygg Docker-imaget

I TrueNAS Shell:

```bash
cd /mnt/tank/apps/fjelltoppene
docker build -t fjelltoppene-web:latest -f deploy/Dockerfile .
```

(TrueNAS Scale 24.10+ bruker Docker direkte. På eldre versjoner: `k3s ctr images import`.)

### Steg 3 — Opprett Custom App

1. **Apps → Discover Apps → Custom App**
2. **Application Name:** `fjelltoppene-web`
3. **Image Repository:** `fjelltoppene-web`
4. **Image Tag:** `latest`
5. **Image Pull Policy:** `IfNotPresent` (siden vi bygde lokalt)
6. **Container Port:** `80`
7. **Node Port (host):** `30080` (eller annen ledig port)
8. Trykk **Install**

Etter ~30 sekunder er siden tilgjengelig på `http://<truenas-ip>:30080`.

---

## Alternativ 2 — Docker Compose direkte

```bash
cd /mnt/tank/apps/fjelltoppene
docker build -t fjelltoppene-web:latest -f deploy/Dockerfile .
docker compose -f deploy/docker-compose.yml up -d
```

Sjekk status:
```bash
docker ps | grep fjelltoppene
docker logs fjelltoppene-web
```

Siden er nå på `http://<truenas-ip>:8080`.

---

## Steg 4 — Gjør tilgjengelig på `fjelltoppene.no`

Du trenger en reverse proxy + SSL-sertifikat. To enkle veier:

### Med Traefik (TrueNAS Scale Custom App)
Allerede satt opp? Legg til labels:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.fjelltoppene.rule=Host(`fjelltoppene.no`)"
  - "traefik.http.routers.fjelltoppene.entrypoints=websecure"
  - "traefik.http.routers.fjelltoppene.tls.certresolver=letsencrypt"
  - "traefik.http.services.fjelltoppene.loadbalancer.server.port=80"
```

### Med Nginx Proxy Manager (enklest GUI)
Installer **Nginx Proxy Manager** fra TrueNAS sin app-katalog:
1. **Hosts → Proxy Hosts → Add Proxy Host**
2. Domain: `fjelltoppene.no`, `www.fjelltoppene.no`
3. Forward to: `<truenas-ip>:30080` (porten fra steg 3)
4. **SSL-fanen** → Request a new SSL Certificate (Let's Encrypt) → Force SSL
5. Save

Sett A-record på domenet til TrueNAS sin offentlige IP. Åpne port 80 + 443 i ruteren.

---

## Oppdatere siden

Når du har nye filer:

```bash
cd /mnt/tank/apps/fjelltoppene
# overskriv index.html / assets med nye versjoner via SMB eller scp
docker build -t fjelltoppene-web:latest -f deploy/Dockerfile .
docker restart fjelltoppene-web
```

Eventuelt: monter filene som volume i stedet for å bygge på nytt:
```yaml
volumes:
  - /mnt/tank/apps/fjelltoppene/index.html:/usr/share/nginx/html/index.html:ro
  - /mnt/tank/apps/fjelltoppene/logo.html:/usr/share/nginx/html/logo.html:ro
  - /mnt/tank/apps/fjelltoppene/assets:/usr/share/nginx/html/assets:ro
```
Da slipper du å bygge på nytt — bare `docker restart fjelltoppene-web`.

---

## Sjekkliste før produksjon

- [ ] DNS: A-record på `fjelltoppene.no` peker til offentlig IP
- [ ] Portforwarding 80/443 → TrueNAS
- [ ] SSL-sertifikat aktivt (Let's Encrypt)
- [ ] Test fra utsiden av nettverket
- [ ] Sett opp e-postadresse `hei@fjelltoppene.no` (eller endre i `index.html` → toast → mailto-lenken)
- [ ] Legg til Google Analytics / Plausible om ønskelig
