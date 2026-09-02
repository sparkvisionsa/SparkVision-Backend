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

The self-contained DOCX worker checks run with:

```bash
docx-worker/venv/bin/python docx-worker/test_merge.py
```

The two legacy full-template integration checks are intentionally opt-in because
their historical input file is not committed. Set
`DOCX_WORKER_REGRESSION_TEMPLATE` to the approved `.docx` file before running
that command to enable them.

On Linux, converting Word or PowerPoint files to PDF currently requires
LibreOffice. The Microsoft Office renderer in this codebase uses Windows COM;
Microsoft 365 cloud conversion is not configured by this repository.

## Healthcheck

- `GET /health`
