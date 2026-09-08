# Spark Vision valuation report — HTML/JS PDF pipeline

Replaces the Python worker with pure Node: **Puppeteer** renders your HTML
template (filled with real data) to a PDF buffer, then **pdf-lib** appends
the real attachment PDFs page-for-page and image attachments as full pages.

## Files

- `report-types.ts` — the flat `ReportData` shape the template consumes.
- `label-maps.ts` — ID → Arabic label maps (purposes, bases, property types, etc).
- `build-report-data.ts` — pure function: `TransactionDoc` + `evalData` → `ReportData`.
  Also re-implements the settlement net-meter-price and replacement-cost math
  from the frontend so the PDF's numbers match what the user saw on screen.
- `report-template.ts` — `renderReportHtml(data)`. Same CSS/classes as your
  supplied template (cover → scope → property details → market approach),
  extended with settlement, replacement cost, appraiser opinion, sign-off,
  a 3-per-row property image grid, and an attachments cover page.
- `transactions-pdf-html.service.ts` — drop-in replacement for
  `TransactionsPdfService`. Same `generatePdf(id, res)` signature, so your
  existing `TransactionsPdfController` needs zero changes — just swap the
  injected service.

## Setup

```bash
npm i puppeteer pdf-lib
# remove the pdf-worker/ python directory and its spawn() call entirely
```

Puppeteer needs a Chromium binary — on most CI/Docker images that means
installing the usual headless-Chrome system deps (fonts, libnss3, etc.), same
as any other Puppeteer deployment. If you're already running Node in a slim
container, budget for that image bump.

## Page flow implemented (now matching the Taqdeer reference PDF's structure)

All wording below is **original** — written fresh for Spark Vision, not
copied from the reference document (only the section order/shape is mirrored,
per copyright limits).

1. Cover
2. Certification summary — methods-used checklist, fair value box, written
   amount, lead appraiser block *(their page 2)*
3. Detailed scope of work — appraiser license info, client/purpose/basis/
   premise/dates table, value-basis definition, independence declaration,
   specialist-assistance note *(their page 3)*
4. Restrictions, disclaimers, assumptions, ESG note, IVS 100/105/106
   compliance *(their page 4)*
5. Fair-value data hierarchy (Level 1 / 2 / 3) *(their page 5)*
6. Search scope & information sources + reliability-confirmation table
   *(their page 6)*
7. Process diagram — 6-step methodology, simplified to stacked cards rather
   than the curvy connector SVG *(their page 7)*
8. **Divider: تفاصيل العقار**
9. Property details — location, condition, boundaries, building-license note
10. Finishing level + services + surrounding environment
11. **Divider: أسلوب التقييم**
12. Methodology — why each approach was/wasn't used, with mechanism + reasons
13. Market approach — comparables table **and** settlement/adjustments table
    together on one page (matches their layout; only rendered if data exists)
14. Cost approach — building-area breakdown + replacement-cost calc
    (only rendered if replacement lines exist)
15. Final opinion — method weighting, final value, team + lead-appraiser
    sign-off
16. **Divider: الملحقات**
17. Maps — coordinates only for now (see TODO below)
18. Property images, 3 per row *(your explicit spec — their reference uses 2;
    kept yours since it was stated directly)*
19. Attachments cover/index page
20. Image attachments (deed scans, registration certs, etc.), one per page
21. **Real attachment PDFs, merged verbatim** — each attachment contributes
    exactly its own page count (a 2-page + a 4-page attachment → 6 pages)
22. Thank-you closing page

## Known gaps / TODOs (marked inline with `TODO`)

- **Maps page has no actual imagery** — the reference embeds a live aerial/
  satellite screenshot with pin overlays; that needs a maps provider (Google
  Static Maps, Mapbox Static Images, etc.) and an API key. Right now it just
  prints the lat/lng as text. Say which provider you want and I'll wire it in.
- `spellOutSar()` in `build-report-data.ts` is a stub — wire in a real
  Arabic number-to-words ("tafqeet") library for the written-amount line.
- `PROPERTY_TYPES` in `label-maps.ts` only has the legacy short list; copy
  over the full ~180-entry list from the frontend's `PROPERTY_TYPES` array.
- Finish-material detail fields (insulation type, door material, per-room
  flooring, license number/expiry, membership numbers) aren't in `EvalData`
  yet — they render as "—". Add the fields to the wizard if you want them
  populated automatically instead of manually per report.
- Investment/DCF/residual/rental-value sections exist in the wizard but
  aren't reference'd in Taqdeer's flow, so I left them out of the PDF —
  say the word if you want them added as extra pages after the cost approach.
- The process-diagram page uses stacked numbered cards instead of the
  reference's curvy SVG connector art — functionally identical, just a
  simpler visual; can be upgraded to matching SVG art if you want that exact
  look.
