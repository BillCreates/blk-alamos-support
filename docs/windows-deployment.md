# Windows-Deployment

## Ziel

Diese Anleitung beschreibt den produktionsartigen Betrieb auf einer Windows-VM mit:

- Docker Desktop fuer den Formular-Container
- Reverse Proxy vor dem Container
- bestehender `n8n`-Instanz als Webhook-Ziel

Der Reverse Proxy veroeffentlicht die oeffentliche Domain. Das Backend selbst soll nicht direkt aus dem Internet erreichbar sein.

## Zielaufbau

- Der Formular-Container laeuft in Docker Desktop auf der Windows-VM
- Das Backend lauscht lokal auf `127.0.0.1:8080`
- Der Reverse Proxy leitet die oeffentliche Domain auf diesen lokalen Port weiter
- `n8n` bleibt getrennt und wird ueber `N8N_WEBHOOK_URL` angesprochen

Wichtig:

- Der Backend-Port `8080` soll nicht oeffentlich offen sein
- `/health` soll nicht ueber den Reverse Proxy veroeffentlicht werden
- Der Proxy muss `X-Proxy-Shared-Secret` an das Backend weitergeben

## Dateien fuer Windows

Fuer Windows werden diese Dateien verwendet:

- [docs/problem-report.windows.production.env](/Users/niklasbaldauf/development/Meldungs%20Formular/docs/problem-report.windows.production.env:1)
- [docker-compose.windows.yml](/Users/niklasbaldauf/development/Meldungs%20Formular/docker-compose.windows.yml:1)

## Produktions-Env vorbereiten

In [docs/problem-report.windows.production.env](/Users/niklasbaldauf/development/Meldungs%20Formular/docs/problem-report.windows.production.env:1) muessen vor dem Deployment mindestens diese Werte angepasst werden:

- `ALLOWED_ORIGINS=https://meldung.alamos-blieskastel.ipv64.net`
- `PROXY_SHARED_SECRET=...`
- `N8N_WEBHOOK_URL=...`
- `N8N_WEBHOOK_SECRET=...`
- optional `GATE_EXPECTED_ANSWER=...`

Wichtig:

- `PROXY_SHARED_SECRET` muss exakt dem Wert im Reverse Proxy entsprechen
- `ALLOW_DIRECT_POST_ACCESS` darf in dieser Datei nicht gesetzt sein

## Docker Compose auf Windows

Der Windows-Compose-Stack nutzt die Produktions-Env und bindet den Backend-Port nur lokal an den Host.

Empfohlener Start:

```bash
docker compose -f docker-compose.windows.yml up -d --build
```

Danach ist das Backend auf der Windows-VM lokal unter `127.0.0.1:8080` erreichbar, aber nicht direkt von extern.

## Reverse-Proxy-Anforderungen

Der Reverse Proxy muss:

- die oeffentliche Domain `meldung.alamos-blieskastel.ipv64.net` terminieren
- HTTPS bereitstellen
- an `http://127.0.0.1:8080` weiterleiten
- den Header `X-Proxy-Shared-Secret` mitschicken
- `/health` nicht veroeffentlichen

Beispiel fuer den zusaetzlichen Header:

```nginx
proxy_set_header X-Proxy-Shared-Secret bitte-langes-zufaelliges-secret;
```

Der gleiche Wert muss in `PROXY_SHARED_SECRET` stehen.

## Worauf beim Proxy zu achten ist

### 1. Keine oeffentliche Weitergabe von `/health`

Wenn der Proxy alle Pfade stumpf an das Backend weitergibt, waere `/health` grundsaetzlich unter der oeffentlichen Domain vorhanden.

Deshalb:

- `/health` im Proxy explizit blocken
- oder nur die benoetigten Formularpfade weiterleiten

Beispiel:

```nginx
location = /health {
    return 404;
}
```

### 2. Backend nur lokal anbinden

Der Backend-Port soll auf dem Windows-Host nur lokal gebunden werden, damit kein externer Direktzugriff auf `8080` moeglich ist.

Deshalb nutzt die Compose-Datei ein lokales Port-Binding:

```yaml
ports:
  - "127.0.0.1:8080:8080"
```

### 3. Proxy-Schutz nicht durch CORS ersetzen

`ALLOWED_ORIGINS` ist nur Browser-Schutz. Das ersetzt nicht den Header-Schutz mit `X-Proxy-Shared-Secret`.

Entscheidend fuer den Produktivschutz ist:

- `PROXY_SHARED_SECRET` gesetzt
- Reverse Proxy setzt `X-Proxy-Shared-Secret`

### 4. HTTPS am Proxy erzwingen

Der Reverse Proxy soll die Domain nur ueber HTTPS bereitstellen.

### 5. Optional zusaetzlich absichern

Sinnvolle Zusatzmassnahmen:

- Rate-Limits am Reverse Proxy
- Request-Body-Limit am Reverse Proxy
- optional Bot-Schutz oder CAPTCHA

## Schritt-fuer-Schritt-Deployment auf Windows

1. Docker Desktop auf der Windows-VM starten
2. Projekt auf die Windows-VM legen
3. [docs/problem-report.windows.production.env](/Users/niklasbaldauf/development/Meldungs%20Formular/docs/problem-report.windows.production.env:1) anpassen
4. Reverse Proxy fuer `meldung.alamos-blieskastel.ipv64.net` konfigurieren
5. Im Proxy den Header `X-Proxy-Shared-Secret` setzen
6. Im Proxy `/health` blocken
7. Container starten:

```bash
docker compose -f docker-compose.windows.yml up -d --build
```

8. Formular ueber die oeffentliche Domain testen
9. Testmeldung absenden
10. Eingang in `n8n` pruefen

## Interner Healthcheck

Der Container nutzt weiterhin:

- `GET /health`

Dieser Endpoint ist fuer interne Checks gedacht, zum Beispiel:

- lokal auf der Windows-VM
- durch interne Ueberwachung
- nicht ueber die oeffentliche Domain

Beispiel lokal auf der Windows-VM:

```bash
curl http://127.0.0.1:8080/health
```

## Go-Live-Checkliste

Vor dem Live-Betrieb sollte folgendes erfuellt sein:

- `ALLOWED_ORIGINS` auf die echte Domain gesetzt
- `PROXY_SHARED_SECRET` gesetzt
- Reverse Proxy setzt `X-Proxy-Shared-Secret`
- `ALLOW_DIRECT_POST_ACCESS` nicht gesetzt
- `/health` nicht oeffentlich veroeffentlicht
- Backend nur auf `127.0.0.1:8080`
- HTTPS aktiv
- Testmeldung erfolgreich in `n8n`

## Empfehlung fuer Produktion

- langes Secret fuer Proxy und Webhook verwenden
- `n8n` nicht ungeschuetzt oeffentlich betreiben
- optional zusaetzlich Proxy-Rate-Limits oder Bot-Schutz aktivieren
