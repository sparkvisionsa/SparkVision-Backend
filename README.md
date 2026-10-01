# Spark Vision Backend

Machine valuation attachment uploads use persisted `mv_attachment_uploads` jobs,
stable per-page file identifiers and MongoDB file leases. Completion verifies
both report workspace references and stored file records. Word/PowerPoint
template export rejects projects with unfinished attachment jobs. No migration
or additional environment variables are needed. Run
`npm run test:attachment-upload-resume` to verify the three attachment workspaces,
storage failures, retry receipts and concurrent editor snapshot preservation
against an isolated MongoDB instance.

Asset media changes are watched directly in MongoDB and emitted to Socket.IO
company rooms. Replica sets support this immediate notification path; standalone
MongoDB or interrupted sockets retain the frontend revision-polling fallback.
`npm run test:asset-media-realtime` tests direct nested database writes through a
real change stream and Socket.IO connection, including tenant isolation.

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

## Support agents

Super admins can manage support access from the support or developer inbox.
Support access permits handling and assigning both kinds of requests; company
roles stay unchanged. Existing UUID user IDs and MongoDB ObjectIds are supported.

To check the two support accounts against the database configured in `.env.local`
or `.env`, then grant access to the existing accounts:

```bash
npm run build
npm run support:agents -- 579228782 596220001
npm run support:agents -- --apply 579228782 596220001
```

The command accepts Saudi numbers with or without `0` / `+966`, checks that each
number matches exactly one unblocked account, and can be rerun safely. It creates
no login accounts or passwords. Open sessions pick up access on their next support
request; refresh the page to update the controls.

Deploy the backend together with the frontend: `GET /api/support/agents` and
`PATCH /api/support/tickets/:id` must reach the updated Nest server. The ticket list
response now includes status `counts` for its kind, product, search and assignee
filters, independently of the selected status and page.
