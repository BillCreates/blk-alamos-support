# n8n-Workflow fuer Jira und Slack

## Ziel

Der Workflow nimmt das JSON aus dem Support-Formular entgegen, erstellt ein Jira-Ticket und sendet danach eine Slack-Mitteilung.

Empfohlener Ablauf:

1. `Webhook`
2. `Set` oder `Edit Fields`
3. `Jira Software`
4. `Slack`
5. `Respond to Webhook`
6. optional: Fehlerpfad mit `Slack` fuer Admin-Hinweis

## Erwartetes Eingabeformat

Das Backend sendet ein JSON in dieser Form:

```json
{
  "requestId": "uuid",
  "submittedAtUtc": "2026-04-19T10:00:00.000Z",
  "name": "Max Mustermann",
  "district": "LB1 (Mitte)",
  "category": "Alarmierung",
  "categoryOther": "",
  "categoryResolved": "Alarmierung",
  "message": "Beschreibung der Stoerung",
  "meta": {
    "pageUrl": "https://formular.example.de/",
    "submittedAtClient": "2026-04-19T10:00:00.000Z",
    "userAgent": "Mozilla/5.0"
  }
}
```

## Node 1: Webhook

Empfohlene Einstellungen:

- Method: `POST`
- Path: `support-form`
- Response: `Using Respond to Webhook Node`
- Authentication: optional, wenn dein `n8n` nicht nur intern erreichbar ist

Hinweis:

Das Backend kann zusaetzlich den Header `X-N8N-Webhook-Secret` senden. Wenn du ihn nutzen willst, pruefe ihn direkt nach dem Webhook mit einem `IF`-Node oder einem `Code`-Node.

## Node 2: Set oder Edit Fields

Lege dir ein sauberes internes Datenmodell an, damit Jira- und Slack-Node einfacher bleiben.

Empfohlene Felder:

- `requestId`
- `summary`
- `description`
- `district`
- `category`
- `reporterName`
- `pageUrl`

Empfohlene Werte:

`summary`

```text
Supportformular | {{$json.categoryResolved}} | {{$json.district}} | {{$json.name}}
```

`description`

```text
Eingang ueber Supportformular

Request-ID: {{$json.requestId}}
Zeitpunkt UTC: {{$json.submittedAtUtc}}
Name: {{$json.name}}
Löschbezirk: {{$json.district}}
Kategorie: {{$json.categoryResolved}}
Seite: {{$json.meta.pageUrl}}
Client-Zeit: {{$json.meta.submittedAtClient}}
User-Agent: {{$json.meta.userAgent}}

Beschreibung:
{{$json.message}}
```

## Node 3: Jira Software

Operation:

- `Issue -> Create`

Empfohlene Zuordnung:

- Project Key: dein Jira-Projekt, z.B. `SUP`
- Issue Type: `Task` oder `Service Request`
- Summary: `{{$json.summary}}`
- Description: `{{$json.description}}`

Optional sinnvolle weitere Felder:

- Labels: `support-form`, `{{$json.category}}`
- Priority: per `IF` oder `Switch`, falls bestimmte Kategorien wichtiger sind
- Custom Field fuer Löschbezirk
- Custom Field fuer Request-ID

Wenn du Custom Fields nutzen willst, ist ein vorgeschalteter `Set`-Node hilfreich, damit die Feldzuordnung sauber bleibt.

## Node 4: Slack

Operation:

- `Message -> Post`

Empfohlener Kanal:

- `#support`
- oder ein dedizierter Incident-Kanal

Empfohlene Nachricht:

```text
Neues Support-Ticket aus dem Formular
Jira: {{$json.key}}
Name: {{$node["Webhook"].json["name"]}}
Löschbezirk: {{$node["Webhook"].json["district"]}}
Kategorie: {{$node["Webhook"].json["categoryResolved"]}}
Request-ID: {{$node["Webhook"].json["requestId"]}}
```

Wenn der Jira-Node den Ticket-Link bereitstellt, sollte der direkt mit in die Nachricht.

## Node 5: Respond to Webhook

Empfohlene Antwort:

```json
{
  "ok": true,
  "jiraIssueKey": "={{$json.key}}"
}
```

Das Formular selbst braucht diese Antwort aktuell nicht zwingend, aber sie ist hilfreich fuer Debugging und Monitoring.

## Optional: Secret-Pruefung im Workflow

Wenn das Backend `N8N_WEBHOOK_SECRET` setzt, sendet es den Header `X-N8N-Webhook-Secret`.

Empfohlener Aufbau:

1. direkt nach `Webhook` ein `IF`-Node
2. pruefe den Headerwert gegen einen festen erwarteten Wert
3. bei Fehler sofort zu `Respond to Webhook` mit `403`

Beispielausdruck fuer den gelesenen Header:

```text
{{$json.headers["x-n8n-webhook-secret"]}}
```

Je nach Webhook-Konfiguration kann der Header in `headers` oder an anderer Stelle landen. Im Testlauf einmal pruefen.

## Optional: Fehlerpfad

Sinnvoll fuer Produktion:

- Jira fehlgeschlagen -> Slack an Admin-Kanal
- Slack fehlgeschlagen -> Fehlerlog oder zweite Benachrichtigung
- Webhook ungueltig -> `Respond to Webhook` mit `403`

## Credentials in n8n

Du brauchst in `n8n` mindestens:

- Jira Credential
- Slack Credential

Diese Credentials gehoeren nur in `n8n`, nicht ins Formular-Backend.

## Teststrategie

1. Webhook in `n8n` auf Test-URL stellen
2. `N8N_WEBHOOK_URL` im Backend auf diese Test-URL setzen
3. Formular lokal absenden
4. in `n8n` Payload pruefen
5. Jira- und Slack-Mapping finalisieren
6. danach auf Production-Webhook umstellen
