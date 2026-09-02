# Spark Vision Backend

Standalone NestJS API for Spark Vision.

## Run

```bash
npm install
npm run dev
```

Default port: `5000`

## Important Scripts

- `npm run build`
- `npm run start:prod`
- `npm run migrate:auth-tracking`
- `npm run optimize:indexes`
- `npm run test:auth-tracking`

## Report workers

Rebuild the two Python environments after a fresh checkout or Python upgrade:

```bash
sudo bash scripts/install-report-system-deps.sh
bash scripts/setup-report-workers.sh
```

The DOCX/PPTX merge workers use `docx-worker/venv`; the WeasyPrint renderer
uses `pdf-worker/.venv`. Their requirements are committed so a deployment does
not depend on a previously copied virtual environment.

On Linux, converting Word or PowerPoint files to PDF currently requires
LibreOffice. The Microsoft Office renderer in this codebase uses Windows COM;
Microsoft 365 cloud conversion is not configured by this repository.

## Healthcheck

- `GET /health`
