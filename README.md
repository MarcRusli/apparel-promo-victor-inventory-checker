# Victor Inventory Checker

Small full stack web tool that reads a kinda secret google sheet and lets you search for items that have at least the requested stock in each size.

## Setup

1. Install deps:
   - `npm install`
2. Configure the sheet URL:
   - Copy `.env.example` to `.env` in `server/` and fill in either `SHEET_CSV_URL` or `SHEET_URL`.
3. Run dev:
   - `npm run dev`

The UI runs on Vite (usually `http://localhost:5173`) and proxies API calls to the backend (usually `http://localhost:8787`).

## API

- `POST /api/search`
  - Body: `{ "XXS": 1, "XS": 0, "S": 2, ... }`
  - Returns: `{ items: [{ category, model }], fetchedAt }`

