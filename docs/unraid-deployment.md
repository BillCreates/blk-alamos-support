# Unraid-Deployment

## Ziel

Dieser Container soll auf Unraid als einzelne App laufen und die bestehende `n8n`-Instanz ueber einen Webhook ansprechen.

Wenn du das Projekt ueber GitHub bauen laesst, kannst du auf Unraid direkt das private Image aus `ghcr.io` nutzen statt lokal zu bauen. Der Build wird dabei ueber einen Git-Tag wie `v1.0.0` ausgeloest.

Empfohlener Aufbau:

- Reverse Proxy vor dem Formular
- Formular-Backend als eigener Container
- bestehendes `n8n` getrennt davon
- wenn moeglich beide im selben Docker-Netz

## Empfohlene Container-Einstellungen

- Repository: `ghcr.io/billcreates/blk-alamos-support:latest` oder ein fester `sha-...` Tag
- Network Type: `bridge` oder ein eigenes Custom-Netz
- Port Mapping:
  - Container Port `8080`
  - Host Port nur dann setzen, wenn dein Reverse Proxy nicht direkt im selben Docker-Netz auf den Container zugreifen kann
  - wenn moeglich kein oeffentliches Host-Port-Mapping verwenden
- Restart Policy: `unless-stopped`
- Optionaler Volume-Mount fuer Env-Datei:
  - Host Path z.B. `/mnt/user/appdata/problem-report/problem-report.env`
  - Container Path z.B. `/config/problem-report.env`

## Empfohlener Weg auf Unraid mit externer Env-Datei

Wenn du nicht jede Variable einzeln in der Unraid-App eintragen willst, kannst du fast alles in eine Datei auslagern.

In Unraid benoetigst du dann nur noch:

- den normalen Port
- optional den Volume-Mount fuer die Env-Datei
- genau eine Umgebungsvariable:
  - `ENV_FILE=/config/problem-report.env`

Das Backend liest diese Datei beim Start ein. Direkt in Unraid gesetzte Umgebungsvariablen ueberschreiben Werte aus der Datei, falls du spaeter einzelne Werte gezielt uebersteuern willst.

## Zugriff auf das private GitHub-Image

Wenn das Image privat ist, muss Unraid sich an `ghcr.io` anmelden.

Ueblicher Login:

- Registry: `ghcr.io`
- Username: dein GitHub-Username, hier z.B. `BillCreates`
- Passwort: ein GitHub Personal Access Token

Fuer das Token reicht in der Regel:

- `read:packages`

Falls du ein feineres Token-Modell nutzt, braucht der Unraid-Host nur Leserechte fuer das private Package.

## Empfohlene Umgebungsvariablen

Pflichtwerte:

- `PORT=8080`
- `N8N_WEBHOOK_URL=https://n8n.example.de/webhook/support-form`
- `GATE_EXPECTED_ANSWER=Einsatzleitwagen`

Empfohlene Sicherheitswerte:

- `TRUST_PROXY=1`
- `PROXY_SHARED_SECRET=bitte-langes-zufaelliges-secret`
- `N8N_WEBHOOK_SECRET=bitte-langes-zufaelliges-secret`
- `ALLOWED_ORIGINS=https://formular.example.de`

Empfohlene Formularwerte:

- `GATE_QUESTION=Was bedeutet die Abkuerzung ELW?`
- `GATE_LABEL=Antwort`
- `GATE_PLACEHOLDER=Antwort eingeben`
- `ALLOWED_DISTRICTS=Löschbezirk 1,Löschbezirk 2,Löschbezirk 3,Löschbezirk 4`
- `ALLOWED_CATEGORIES=Zugang / Login,Softwarefehler,Datenproblem,Bedienung / Frage,Sonstiges`

Empfohlene Rate-Limits:

- `SESSION_TTL_MS=14400000`
- `RATE_LIMIT_WINDOW_MS=900000`
- `RATE_LIMIT_MAX_REQUESTS=10`
- `RATE_LIMIT_GATE_WINDOW_MS=600000`
- `RATE_LIMIT_GATE_MAX_REQUESTS=10`
- `JSON_LIMIT=20kb`

## Alternative: Antwort nur als Hash speichern

Wenn du die Gate-Antwort nicht im Klartext in Unraid pflegen willst:

- `GATE_EXPECTED_ANSWER` leer lassen
- stattdessen `GATE_ANSWER_HASH=<sha256-hash-der-normalisierten-antwort>`

Die Normalisierung im Backend ist:

- trimmen
- in Kleinbuchstaben umwandeln
- Mehrfach-Leerzeichen zusammenfassen

## Reverse-Proxy-Empfehlung

Wenn du Nginx Proxy Manager oder SWAG davor nutzt:

- HTTPS erzwingen
- nur auf den Backend-Container weiterleiten
- Request-Body begrenzen
- optional Rate-Limit auch am Proxy setzen
- `X-Proxy-Shared-Secret` serverseitig mitschicken

Wichtig:

- `ALLOW_DIRECT_POST_ACCESS` in Produktion nicht setzen
- `/health` nicht ueber den Reverse Proxy veroeffentlichen
- `PROXY_SHARED_SECRET` muss im Proxy und im Container identisch gesetzt sein
- `ALLOWED_ORIGINS` ist nur Browser-Schutz und ersetzt nicht den Proxy-Schutz

Beispiel fuer den zusaetzlichen Header:

```nginx
proxy_set_header X-Proxy-Shared-Secret bitte-langes-zufaelliges-secret;
```

Der gleiche Wert muss in Unraid als `PROXY_SHARED_SECRET` gesetzt sein.

## Empfohlene Unraid-Variablenliste

Du kannst diese Variablen direkt als Container-Umgebungsvariablen anlegen:

```text
PORT=8080
TRUST_PROXY=1
ALLOWED_ORIGINS=https://formular.example.de
PROXY_SHARED_SECRET=change-me
N8N_WEBHOOK_URL=https://n8n.example.de/webhook/support-form
N8N_WEBHOOK_SECRET=change-me
GATE_QUESTION=Was bedeutet die Abkuerzung ELW?
GATE_LABEL=Antwort
GATE_PLACEHOLDER=Antwort eingeben
GATE_EXPECTED_ANSWER=Einsatzleitwagen
ALLOWED_DISTRICTS=Löschbezirk 1,Löschbezirk 2,Löschbezirk 3,Löschbezirk 4
ALLOWED_CATEGORIES=Zugang / Login,Softwarefehler,Datenproblem,Bedienung / Frage,Sonstiges
SESSION_TTL_MS=14400000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=10
RATE_LIMIT_GATE_WINDOW_MS=600000
RATE_LIMIT_GATE_MAX_REQUESTS=10
JSON_LIMIT=20kb
```

Oder als Datei `problem-report.env` ablegen und nur `ENV_FILE=/config/problem-report.env` in Unraid setzen:

```text
PORT=8080
TRUST_PROXY=1
ALLOWED_ORIGINS=https://formular.example.de
PROXY_SHARED_SECRET=change-me
N8N_WEBHOOK_URL=https://n8n.example.de/webhook/support-form
N8N_WEBHOOK_SECRET=change-me
GATE_QUESTION=Was bedeutet die Abkuerzung ELW?
GATE_LABEL=Antwort
GATE_PLACEHOLDER=Antwort eingeben
GATE_EXPECTED_ANSWER=Einsatzleitwagen
ALLOWED_DISTRICTS=Löschbezirk 1,Löschbezirk 2,Löschbezirk 3,Löschbezirk 4
ALLOWED_CATEGORIES=Zugang / Login,Softwarefehler,Datenproblem,Bedienung / Frage,Sonstiges
SESSION_TTL_MS=14400000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=10
RATE_LIMIT_GATE_WINDOW_MS=600000
RATE_LIMIT_GATE_MAX_REQUESTS=10
JSON_LIMIT=20kb
```

## Healthcheck

Der Container nutzt:

- `GET /health`

Wenn du auf Unraid eigene Checks hinterlegen willst, ist das die richtige URL. Der Endpoint ist fuer interne Requests gedacht und sollte nicht oeffentlich veroeffentlicht werden.

## Starttest nach Deployment

1. Container starten
2. internen Healthcheck pruefen, z. B. direkt vom Unraid-Host oder aus dem internen Netz
3. Formular aufrufen
4. Sicherheitsfrage testen
5. Testmeldung absenden
6. in `n8n` den Webhook-Eingang pruefen
7. Jira-Ticket und Slack-Nachricht kontrollieren

## Go-Live-Checkliste

Vor dem oeffentlichen Einsatz sollte folgendes erfuellt sein:

- `PROXY_SHARED_SECRET` gesetzt
- `ALLOW_DIRECT_POST_ACCESS` nicht gesetzt
- `ALLOWED_ORIGINS` auf die echte Formular-Domain gesetzt
- `/health` nicht am Reverse Proxy freigegeben
- Reverse Proxy setzt `X-Proxy-Shared-Secret`
- HTTPS aktiv
- optional zusaetzliches Rate-Limit oder Bot-Schutz am Proxy

## Empfehlung fuer Produktion

- `n8n`-Webhook nach Moeglichkeit nicht oeffentlich ohne Zusatzschutz betreiben
- langes Secret fuer Proxy und Webhook verwenden
- wenn das Formular wirklich frei erreichbar bleibt, zusaetzlich Cloudflare Turnstile oder CAPTCHA einplanen
- Kategorien und Löschbezirke vor Go-Live finalisieren
