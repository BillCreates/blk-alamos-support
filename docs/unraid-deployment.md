# Unraid-Deployment

## Ziel

Dieser Container soll auf Unraid als einzelne App laufen und die bestehende `n8n`-Instanz ueber einen Webhook ansprechen.

Empfohlener Aufbau:

- Reverse Proxy vor dem Formular
- Formular-Backend als eigener Container
- bestehendes `n8n` getrennt davon
- wenn moeglich beide im selben Docker-Netz

## Empfohlene Container-Einstellungen

- Repository: dein gebautes Image oder lokaler Build
- Network Type: `bridge` oder ein eigenes Custom-Netz
- Port Mapping:
  - Container Port `8080`
  - Host Port z.B. `8080`
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

Wenn du auf Unraid eigene Checks hinterlegen willst, ist das die richtige URL.

## Starttest nach Deployment

1. Container starten
2. `http://UNRAID-IP:8080/health` pruefen
3. Formular aufrufen
4. Sicherheitsfrage testen
5. Testmeldung absenden
6. in `n8n` den Webhook-Eingang pruefen
7. Jira-Ticket und Slack-Nachricht kontrollieren

## Empfehlung fuer Produktion

- `n8n`-Webhook nach Moeglichkeit nicht oeffentlich ohne Zusatzschutz betreiben
- langes Secret fuer Proxy und Webhook verwenden
- wenn das Formular wirklich frei erreichbar bleibt, zusaetzlich Cloudflare Turnstile oder CAPTCHA einplanen
- Kategorien und Löschbezirke vor Go-Live finalisieren
