# Google Sheets Sync Setup

SalesCommand can pull directly from two Google Sheets:

- Numbers sheet: daily/setter activity metrics.
- Post-call sheet: closer post-call form responses.

## 1. Create Google service account credentials

Create a Google Cloud service account, enable the Google Sheets API, and create a JSON key.

Add these values to your SalesCommand environment:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SHEETS_AUTH_MODE=public
GOOGLE_SHEETS_NUMBERS_ID=1-FAu_cOnldCq-0EqAT_CFy4duFCgjwsNC9635sOCmQk
GOOGLE_SHEETS_NUMBERS_RANGE=Setter Stats!A:Z
GOOGLE_SHEETS_POST_CALL_ID=1-FAu_cOnldCq-0EqAT_CFy4duFCgjwsNC9635sOCmQk
GOOGLE_SHEETS_POST_CALL_RANGE=PCF responses!A:Z
GOOGLE_SHEETS_SYNC_SECRET=
```

The current workbook is:

`https://docs.google.com/spreadsheets/d/1-FAu_cOnldCq-0EqAT_CFy4duFCgjwsNC9635sOCmQk/edit`

If `GOOGLE_SHEETS_AUTH_MODE=public`, the workbook must stay accessible by link.

If you switch to service account auth, share the workbook with the service account email as a viewer. `GOOGLE_PRIVATE_KEY` should keep newline characters as `\n` when stored in most deployment dashboards.

## 2. Trigger a sync

Manual sync:

```bash
curl -X POST "https://YOUR_DOMAIN.com/api/google-sheets/sync?secret=YOUR_SYNC_SECRET"
```

You can also run this URL from a scheduled job or cron monitor.

## 3. Recommended sheet headers

Numbers sheet:

```text
Date, Rep, Dials, Conversations, Offers, Calls Booked, Showed Calls, Closed Calls, Cash Collected, Revenue Generated
```

Post-call form sheet:

```text
Call Date, Closer, Close Contact ID, Close Opportunity ID, Status, Product, Outcome Notes, Cash Collected, Revenue Generated, Objections, Objection Notes, Call Recording URL
```

Status values can be:

```text
booked, showed, no_show, closed, lost
```

Rep matching uses the `reps.name` value in Supabase, so sheet rep names should match SalesCommand rep names.
