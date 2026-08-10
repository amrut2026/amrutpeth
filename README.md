# FoodMart — B2B Packaged Food Distribution Platform (PoC)

A 3-tier web application for a manufacturer → dealer → retailer packaged-food
supply chain, with barcode-driven POS billing, inventory, purchases, vouchers,
receivables/payments, reporting, and a generic role/activity permission layer.

## Architecture (3-tier)

| Tier | Technology | Why |
|---|---|---|
| Presentation | React 18 + Vite + Tailwind CSS | Fast SPA, free hosting on Vercel/Netlify |
| Application / API | Node.js + Express + Prisma ORM | Simple REST API, JWT auth, easy to extend |
| Data | PostgreSQL | Free-tier managed Postgres (Neon / Supabase / Railway) |

All three tiers are independently deployable, which is what "3-tier" means here:
the browser never talks to the database directly — everything goes through the
Express API, which is the only thing holding the DB credentials.

## Modules implemented

- **Auth**: JWT login, roles `ADMIN` (manufacturer/platform), `DEALER`, `RETAILER`
- **Organisation (Mahamandal)**: apex-body record (`org_name`, `org_address`, `org_contact`, `org_type`)
- **RBAC**: `user_roles`, `activities`, `role_activity_mapping` tables + a matrix UI to
  grant/revoke which role can use which module (from your `user_roles.json` / `activities.json`)
- **Dealer module**: ID, name, address, contact, GST, multiple bank accounts (account no + IFSC)
- **Retailer module**: same fields + primary dealer (supplier) link
- **Product catalog**: category + product (size/weight, cost price, selling price,
  discount, MRP, mfg/expiry dates, batch, FSSAI code), auto-generated barcode,
  and a **Print Labels** button that renders CODE128 barcodes for sticking on products
- **Sales / POS**: barcode field that accepts both manual typing and a hardware
  barcode-scanner (scanners act as fast keyboard input + Enter, so no special
  driver integration is needed), cash/UPI/card payment capture, dealer-side
  toggle between "cash customer" and a specific retailer, and a
  `POST /api/sales/pos-webhook` endpoint so a card/UPI POS terminal's software
  can push a paid transaction straight into the sales module
- **Purchases / Inwards**: stock-in against a product, auto-increments inventory
- **Inventory**: per-owner (dealer or retailer) stock with a configurable reorder
  level and a low-stock flag surfaced on the dashboard and reports
- **Vouchers**: auto-generated when a dealer sells to a retailer (or created
  manually) — represents the dealer's receivable from that retailer
- **Receipts**: retailer payments recorded against a voucher; voucher status
  moves OPEN → PARTIALLY_PAID → PAID automatically
- **Payments**: dealer → manufacturer payment log
- **Reports**: role-aware — dealers see products dispatched + retailer
  receivables + inventory; retailers see their own inventory and sales

## Project layout

```
foodmart/
  backend/         Express API + Prisma schema
  frontend/        React + Vite + Tailwind SPA
  reference-json/  Your original JSON specs, kept for traceability
```

## Running locally

### 1. Database
Create a free Postgres instance (see "Free hosting" below), or run Postgres locally:
```
docker run --name foodmart-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=foodmart -p 5432:5432 -d postgres:16
```

### 2. Backend
```
cd backend
cp .env.example .env        # fill in DATABASE_URL, DIRECT_URL (if using Supabase) + JWT_SECRET
npm install
npx prisma migrate dev --name init
npm run seed                 # creates admin/dealer/retailer demo logins + RBAC + org
npm run dev                  # http://localhost:4000
```

Demo logins after seeding:
- `admin / admin123` (ADMIN / manufacturer)
- `dealer1 / dealer123`
- `retailer1 / retailer123`

### 3. Frontend
```
cd frontend
npm install
npm run dev                  # http://localhost:5173
```
Set `VITE_API_URL` in a `.env` file if the API isn't on `localhost:4000`.

## Deploying free for the PoC

This stays entirely on free tiers until you're ready to upgrade.

1. **Database — Neon** (neon.tech) or **Supabase** (supabase.com), free Postgres tier.
   Copy the connection string into `DATABASE_URL`.
2. **Backend — Render** (render.com) free Web Service:
   - Root directory: `backend`
   - Build command: `npm install && npx prisma generate && npx prisma migrate deploy`
   - Start command: `npm start`
   - Env vars: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN` (your frontend URL)
   - Run `npm run seed` once via Render's shell (or a one-off job) to load demo data.
3. **Frontend — Vercel** or **Netlify** free tier:
   - Root directory: `frontend`
   - Build command: `npm run build`, output dir: `dist`
   - Env var: `VITE_API_URL=https://<your-render-service>.onrender.com/api`

Free-tier caveats for the PoC: Render's free web service sleeps after
inactivity (first request after idle takes ~30–60s), and Neon/Supabase free
Postgres has storage/connection limits — both are fine for a PoC and are the
first things to upgrade when you move to a paid plan.

### IPv4 / IPv6 note (Supabase)

Supabase's raw direct-connection host (`db.<project-ref>.supabase.co:5432`) is
**IPv6-only** unless you purchase their IPv4 add-on. If you deploy from a
network or platform without IPv6 (common for home ISPs, some corporate
networks, and some free-tier hosts), always connect via the **pooler**
hostname (`*.pooler.supabase.com`) instead — it supports both IPv4 and IPv6.
Use the Transaction pooler (port 6543, `?pgbouncer=true`) for `DATABASE_URL`
and the Session pooler (port 5432, same hostname) for `DIRECT_URL`. See
`backend/.env.example` for the exact format.

## POS / hardware notes

- **Barcode scanners**: virtually all USB/Bluetooth barcode scanners emulate a
  keyboard, so the Sales page's barcode field works with them out of the box —
  no driver or SDK integration needed.
- **Card/UPI POS terminals**: true "push from POS to app" requires the
  terminal vendor's integration API (e.g. Pine Labs, Razorpay POS, Paytm
  EDC). The `/api/sales/pos-webhook` endpoint is built to be that landing
  spot — once you pick a POS vendor, their webhook/callback gets pointed here.

## Next steps toward production

- Move JWT secret + DB credentials to a proper secrets manager
- Add refresh tokens / session expiry handling in the frontend
- Add server-side pagination for large product/sales lists
- Wire the RBAC `role_activity_mapping` table into actual route guards
  (currently it's a management UI; the coarse `ADMIN/DEALER/RETAILER` roles
  are what enforce access today)
- Move to a paid Postgres + always-on backend once beyond PoC traffic
