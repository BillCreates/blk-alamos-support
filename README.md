# Support-Formular fuer Unraid mit n8n, Jira und Slack

## Zielbild

Dieses Projekt ist fuer einen einfachen und robusten Betrieb auf Unraid ausgelegt:

1. Der Browser ruft das Formular ueber das Node-Backend auf.
2. Das Backend liefert die statische Seite unter `/` aus.
3. Die Sicherheitsfrage wird serverseitig ueber Umgebungsvariablen gesteuert.
4. Das Backend validiert die Meldung und sendet ein festes JSON-Payload an `n8n`.
5. `n8n` erstellt daraus ein Jira-Ticket und sendet eine Slack-Mitteilung.

Damit gibt es keine CORS-Probleme zwischen Formular und API, und alle sicherheitsrelevanten Werte bleiben ausserhalb des Codes.

## Architektur

- `backend/public/index.html`
  Statische Formularseite, wird direkt vom Backend ausgeliefert
- `backend/src/server.js`
  API, Sicherheitsfrage, Session-Token, Validierung, Rate Limit und Weiterleitung an `n8n`
- `backend/.env.example`
  Beispiel fuer alle wichtigen Laufzeitvariablen
- `docker-compose.yml`
  Startet nur das Formular-Backend
- `.github/workflows/docker-publish.yml`
  Baut bei Git-Tags wie `v1.0.0` automatisch ein privates Docker-Image in `ghcr.io`
- `docs/n8n-workflow.md`
  Konkrete Vorlage fuer den n8n-Ablauf mit Jira und Slack
- `docs/unraid-deployment.md`
  Konkrete Vorlage fuer Unraid, Container-Variablen und Proxy

`n8n` wird hier bewusst nicht mitgestartet, weil auf deinem Unraid-Server bereits eine eigene `n8n`-Instanz laeuft.

## Sicherheitsmodell

Sicherheitsrelevante Werte werden ueber Umgebungsvariablen gesteuert:

- `GATE_EXPECTED_ANSWER` oder `GATE_ANSWER_HASH`
- `PROXY_SHARED_SECRET`
- `N8N_WEBHOOK_URL`
- `N8N_WEBHOOK_SECRET`
- `ALLOWED_ORIGINS`
- `RATE_LIMIT_*`

Die Sicherheitsfrage ist vollstaendig austauschbar, ohne das Frontend oder Backend anfassen zu muessen:

- `GATE_QUESTION`
- `GATE_LABEL`
- `GATE_PLACEHOLDER`
- `GATE_EXPECTED_ANSWER`

Zusätzlich kann der Container eine externe Env-Datei laden:

- `ENV_FILE=/config/problem-report.env`

Wenn `ENV_FILE` gesetzt ist, liest das Backend diese Datei beim Start ein. Direkt im Container gesetzte Umgebungsvariablen haben dabei Vorrang.

Wenn du die Antwort nicht im Klartext in der Umgebung haben willst, kannst du stattdessen nur `GATE_ANSWER_HASH` setzen.

## Formular-Endpunkte

- `GET /`
  Formularseite
- `GET /health`
  Healthcheck fuer Docker
- `GET /api/gate-config`
  Liefert den sichtbaren Text der Sicherheitsfrage an das Frontend
- `POST /api/gate`
  Prueft die Sicherheitsfrage und stellt ein Session-Token aus
- `POST /api/problem-report`
  Validiert die Meldung und sendet sie an `n8n`

## Beispiel fuer das JSON an n8n

```json
{
  "requestId": "uuid",
  "submittedAtUtc": "2026-04-19T10:00:00.000Z",
  "name": "Max Mustermann",
  "district": "Löschbezirk 1",
  "category": "Softwarefehler",
  "categoryOther": "",
  "categoryResolved": "Softwarefehler",
  "message": "Beschreibung der Stoerung",
  "meta": {
    "pageUrl": "https://formular.example.de/",
    "submittedAtClient": "2026-04-19T10:00:00.000Z",
    "userAgent": "Mozilla/5.0"
  }
}
```

## n8n-Empfehlung

Der sinnvollste Ablauf in `n8n` ist:

1. Webhook empfaengt das JSON
2. Optional: `IF` fuer Pflichtfelder oder Priorisierung
3. Jira-Node erstellt das Ticket
4. Slack-Node sendet die Mitteilung
5. Optional: Fehlerzweig mit eigener Slack- oder Mail-Benachrichtigung

Empfehlung fuer Slack:

- Ticket-Key
- Kategorie
- Löschbezirk
- Kurztext oder erste Zeilen der Meldung
- Link zum Jira-Ticket

Die ausfuehrliche Vorlage liegt in [docs/n8n-workflow.md](/Users/niklasbaldauf/development/Meldungs%20Formular/docs/n8n-workflow.md:1).

## Lokaler Start mit Docker Compose

1. `backend/.env.example` nach `backend/.env` kopieren
2. Werte anpassen
3. starten:

```bash
docker compose up -d --build
```

Danach ist das Formular unter `http://localhost:8080/` erreichbar.

## Unraid-Einsatz

Auf Unraid kannst du denselben Container nutzen und die Variablen direkt in der Container-Konfiguration setzen. Die Werte muessen nicht im Image liegen.

Alternativ kannst du auf Unraid nur eine einzige Variable setzen und den Rest in eine gemountete Datei auslagern:

- Host-Pfad z.B. `/mnt/user/appdata/problem-report/problem-report.env`
- im Container gemountet z.B. nach `/config/problem-report.env`
- Container-Variable: `ENV_FILE=/config/problem-report.env`

Empfohlener Betrieb:

- Reverse Proxy vor den Container
- HTTPS erzwingen
- optional `X-Proxy-Shared-Secret` am Proxy setzen
- `N8N_WEBHOOK_URL` auf deine bestehende `n8n`-Instanz zeigen lassen
- Container und `n8n` wenn moeglich im selben Docker-Netz betreiben

Die konkrete Unraid-Vorlage liegt in [docs/unraid-deployment.md](/Users/niklasbaldauf/development/Meldungs%20Formular/docs/unraid-deployment.md:1).

## GitHub und Docker-Image

Das Repository kann privat bleiben. GitHub Actions baut das Container-Image automatisch, sobald du einen Git-Tag mit `v` pushst, zum Beispiel `v1.0.0`.

Dabei entstehen zum Beispiel diese Tags:

- `ghcr.io/billcreates/blk-alamos-support:v1.0.0`
- `ghcr.io/billcreates/blk-alamos-support:latest`
- `ghcr.io/billcreates/blk-alamos-support:sha-<commit>`

Der Workflow liegt in [.github/workflows/docker-publish.yml](/Users/niklasbaldauf/development/Meldungs%20Formular/.github/workflows/docker-publish.yml:1).

Wichtig fuer den ersten Lauf:

- In GitHub unter dem Repo `Actions` aktivieren
- einen Versions-Tag wie `v1.0.0` erstellen und pushen
- danach erscheint das Package unter `Packages`

Wenn das Image privat bleiben soll, ist das mit `ghcr.io` moeglich. Auf Unraid brauchst du dann GitHub-Zugangsdaten mit Paket-Leserechten.

## Hinweise zur Sicherheitsfrage

Die Antwort wird serverseitig normalisiert:

- fuehrende und nachgestellte Leerzeichen werden entfernt
- alles wird in Kleinbuchstaben umgewandelt
- mehrfache Leerzeichen werden zu einem Leerzeichen zusammengefasst

Wenn du `GATE_EXPECTED_ANSWER` setzt, berechnet das Backend daraus selbst den Vergleichswert.

Wenn du lieber einen Hash setzen willst, muss dieser auf genau der normalisierten Antwort basieren.

## Wichtige offene Anpassungen vor Produktion

- echte Werte fuer `Löschbezirk`
- echte Kategorien
- echte `ALLOWED_ORIGINS`
- echtes Reverse-Proxy-Setup
- `n8n`-Workflow fuer Jira und Slack
