<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=c94b1e,e8a020&height=200&section=header&text=⚙️%20GEARSHIFT&fontSize=64&fontAlignY=40&desc=Auto%20Shop%20Management%20—%20Built%20for%20Nigeria&descAlignY=60&descSize=16&fontColor=ffffff&animation=fadeIn" width="100%"/>

</div>

<div align="center">

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=14&duration=2800&pause=700&color=E8A020&center=true&vCenter=true&multiline=false&repeat=true&width=680&lines=Multi-tenant+SaaS+%7C+Vanilla+JS+%2B+Supabase+%2B+PostgreSQL;Role-based+access+control+%7C+Real-time+data+%7C+₦+Paystack+payments;Built+from+scratch.+Shipped+to+production.+Used+by+real+workshops.)](https://git.io/typing-svg)

</div>

<div align="center">

![Status](https://img.shields.io/badge/Status-Production_Ready-27ae60?style=for-the-badge)
![Version](https://img.shields.io/badge/Version-1.0.0-c94b1e?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-e8a020?style=for-the-badge)
![Made in Nigeria](https://img.shields.io/badge/Made_in-Nigeria_🇳🇬-008751?style=for-the-badge)

</div>

---

<br/>

## ❓ WHY

> *"Most auto workshops in Nigeria still run on paper, WhatsApp messages, and memory."*

Walk into any mechanic workshop in Kaduna, Lagos, or Port Harcourt. You'll find:

- 📝 Job cards written in notebooks — lost, illegible, forgotten
- 📱 Customer updates sent as ad-hoc WhatsApp texts
- 🧾 Invoices typed in Word, printed, and filed in folders
- 🔩 No idea which parts are running low until a job grinds to a halt
- 💸 Revenue figures that exist only in the owner's head

**The Nigerian automotive sector services millions of vehicles. None of its tooling was built for it.**

GearShift was built to change that — a full operations platform designed around how Nigerian workshops actually work, priced for the Nigerian market (₦10,500/month), and built by someone who understands the infrastructure constraints of operating in Nigeria.

---

<br/>

## 🔍 WHAT

**GearShift is a multi-tenant SaaS platform** that gives automotive workshops a complete digital nervous system — from the moment a customer drives in to the moment they drive out and pay online.

<br/>

### 🗺️ System at a Glance

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GEARSHIFT PLATFORM                          │
├──────────────┬──────────────┬──────────────┬────────────────────────┤
│  PUBLIC LAYER│  AUTH LAYER  │  APP LAYER   │    DATA LAYER          │
│              │              │              │                        │
│  booking.html│  dashboard   │  Work Orders │  Supabase PostgreSQL   │
│  (no login)  │  (sign in /  │  Inventory   │  + Row Level Security  │
│              │   register)  │  Invoices    │                        │
│  QR Code     │              │  Customers   │  shop_id scopes ALL    │
│  share link  │  RBAC guard  │  Appointments│  queries — shops never │
│              │  on every    │  Supply Chain│  see each other's data │
│              │  app page    │  Reports     │                        │
│              │              │  Settings    │  Realtime subscriptions│
│              │              │  Staff       │  on key tables         │
│              │              │  Notifications│                       │
└──────────────┴──────────────┴──────────────┴────────────────────────┘
```

<br/>

### ✅ Feature Matrix

| Module | What it does | Key detail |
|---|---|---|
| 🔐 **Auth & Roles** | Admin · Service Advisor · Mechanic · Parts Manager | Each role sees a different UI; RBAC enforced on every page load |
| 📋 **Work Orders** | Kanban board + list view, status history, parts attachment | Status changes trigger WhatsApp customer notifications |
| 👤 **Customers & Vehicles** | Full CRM with VIN auto-fill via NHTSA API | Delete cascade removes all linked records atomically |
| 📦 **Inventory** | Parts catalog, stock levels, low-stock alerts | Adjustments logged; stock auto-decrements on WO parts attach |
| 🚚 **Supply Chain** | Supplier profiles, purchase orders, receive tracking | POs sharable via WhatsApp / print-to-PDF |
| 🧾 **Invoices** | Auto-generate from work orders, PDF print, email | Online payment via Paystack with 5% commission split |
| 🗓️ **Appointments** | Calendar view, online booking page, QR code sharing | Public booking page requires no login — customers book directly |
| 🔔 **Notifications** | Real-time in-app alerts by category | WhatsApp completion messages sent to customers |
| 📊 **Reports & Dashboard** | KPI cards, revenue charts, low-stock summaries | Live data via Supabase Realtime |
| 💳 **Billing** | Pro plan (₦10,500/mo · ₦90,000/yr) via Paystack | Subaccount commission splits automatic on invoice payments |

---

<br/>

## ⚙️ HOW

### Architecture

GearShift is deliberately built with **no heavy frontend framework** — vanilla HTML, CSS, and JavaScript. This was a conscious decision:

- ✅ Zero build step — deploys anywhere (Vercel, Netlify, S3, even a USB drive)
- ✅ No dependency hell — the codebase will work in 5 years without touching it
- ✅ Forces clean separation of concerns — data layer (`supabase.js`), auth (`rbac.js`), utilities (`main.js`)
- ✅ Proves that framework != quality — architecture and discipline do

The backend is entirely **Supabase** — PostgreSQL with Row Level Security so every query is automatically tenant-scoped.

<br/>

<details>
<summary><b>🗄️ Data Architecture — click to expand</b></summary>

<br/>

**Multi-tenancy Pattern**

Every table that belongs to a shop has a `shop_id` foreign key. The `_shopId()` function in `supabase.js` resolves and caches the current user's shop. Every single read and write is scoped:

```javascript
// Every query follows this exact pattern
async function getWorkOrders() {
  const sid = await _shopId();          // resolves + caches shop
  const { data } = await sb
    .from('work_orders')
    .select('*')
    .eq('shop_id', sid)                 // tenant scope — non-negotiable
    .order('created_at', { ascending: false });
  return data;
}
```

**Row Level Security**

RLS policies are the last line of defence. Even if application code has a bug, the database refuses to return data that doesn't belong to the authenticated user's shop.

**Key Tables**

```
shops               → root tenant record
profiles            → staff, linked to shop via shop_id
customers           → shop's customer CRM
vehicles            → linked to customers
work_orders         → core operational record
work_order_parts    → parts used in a job
inventory           → parts stock
suppliers           → parts suppliers
purchase_orders     → restock orders
invoices            → billing records
appointments        → calendar + online booking
notifications       → in-app alert system
billing_transactions→ subscription + commission log
audit_logs          → change history
wo_status_history   → work order timeline
```

</details>

<br/>

<details>
<summary><b>🔐 Auth & RBAC — click to expand</b></summary>

<br/>

**Registration Flow**
1. Admin registers with shop name → Supabase creates auth user
2. DB trigger creates `profiles` row with `role = 'Admin'`
3. `linkShopToProfile()` creates `shops` row and links `shop_id`
4. Email confirmation required before first sign-in
5. `gs_pending_shop` localStorage fallback handles edge cases

**Role Permission Matrix**

| Section | Admin | Service Advisor | Mechanic | Parts Manager |
|---|:---:|:---:|:---:|:---:|
| Dashboard | ✅ Full | ✅ Full | 👁 Read | 👁 Read |
| Appointments | ✅ Full | ✅ Full | 👁 Read | ❌ |
| Customers | ✅ Full | ✅ Full | ❌ | ❌ |
| Work Orders | ✅ Full | ✅ Full | 👁 Read | 👁 Read |
| Inventory | ✅ Full | 👁 Read | ❌ | ✅ Full |
| Supply Chain | ✅ Full | ❌ | ❌ | ✅ Full |
| Invoices | ✅ Full | ✅ Full | ❌ | ❌ |
| Reports | ✅ Full | ❌ | ❌ | ❌ |
| Settings | ✅ Full | ❌ | ❌ | ❌ |

**Page Guard Pattern** — every app page calls `RBAC.guardPage('section')` on load. If the user's role doesn't have access, they're redirected before any data is fetched.

</details>

<br/>

<details>
<summary><b>💳 Payments Architecture (Paystack) — click to expand</b></summary>

<br/>

GearShift has two distinct payment flows:

**1 — Pro Plan Subscription**
```
User clicks Upgrade → PaystackPop.setup() opens
→ Customer pays ₦10,500/mo or ₦90,000/yr
→ Paystack callback fires on success
→ shops.plan = 'pro', plan_expires_at = +1mo/yr
→ billing_transactions row created
→ RBAC cache cleared → UI updates immediately
```

**2 — Invoice Online Payment (with Commission Split)**
```
Staff clicks "Pay Online" on invoice
→ Shop must have a Paystack subaccount set up
→ PaystackPop.setup() fires with:
     subaccount: shop's ACC_xxx code
     transaction_charge: 5% of invoice amount  ← GearShift commission
     bearer: 'account'                          ← shop pays Paystack fee
→ Paystack handles the split automatically:
     95% → shop's bank account (same day settlement)
      5% → GearShift's account (commission)
→ Invoice marked Paid, billing_transactions logged
```

**Edge Functions** (Supabase Deno runtime)
- `resolve-bank-account` — verifies Nigerian bank accounts via Paystack API
- `create-paystack-subaccount` — creates the split subaccount per shop

</details>

<br/>

<details>
<summary><b>📱 WhatsApp Notifications — click to expand</b></summary>

<br/>

When a work order is marked **Completed**, GearShift:

1. Fetches the customer's phone number from the database
2. Normalises it to Nigerian international format: `0801...` → `2348010...`
3. Builds a pre-written completion message with shop name, vehicle, and job summary
4. Opens `wa.me/234...?text=...` — staff taps Send on WhatsApp Web or the app
5. Stamps `customer_notified_at` on the work order record
6. A green badge appears on the kanban card confirming notification

The message is **editable** before sending — staff can personalise it. A Reset button restores the original if needed.

</details>

<br/>

<details>
<summary><b>🔩 VIN Auto-Fill — click to expand</b></summary>

<br/>

When adding a vehicle (customer form, edit vehicle modal, or appointment booking), typing a 17-character VIN triggers the **NHTSA Vehicle API** (free, no key required):

```
User types VIN → 17 chars reached → debounce 300ms
→ fetch https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/{VIN}
→ Extract: Make, Model, Year, Body Class, Fuel Type, Cylinders
→ Auto-fill form fields (only if currently empty)
→ Show green success card with vehicle details
→ Results cached — same VIN won't hit API twice
```

Covers virtually all vehicles sold globally — Toyota, Honda, Hyundai, Kia, Mercedes, BMW, Nigerian-spec vehicles all decode correctly.

</details>

---

<br/>

### 🧰 Full Tech Stack

<div align="center">

![JavaScript](https://img.shields.io/badge/JavaScript_ES2022-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Deno](https://img.shields.io/badge/Deno_Edge_Functions-000000?style=flat-square&logo=deno&logoColor=white)
![Paystack](https://img.shields.io/badge/Paystack-00C3F7?style=flat-square&logo=stripe&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)

</div>

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | Vanilla HTML/CSS/JS | No build step. Pure portability. Framework-agnostic by design. |
| **Database** | PostgreSQL via Supabase | RLS for multi-tenancy. Realtime subscriptions. Managed infra. |
| **Auth** | Supabase Auth | JWT sessions, email confirmation, OAuth-ready. |
| **Payments** | Paystack | Best Nigerian gateway. Cards, bank transfer, USSD, Opay, PalmPay. |
| **Edge Functions** | Supabase Deno Runtime | Server-side secrets for Paystack API calls. No Node server needed. |
| **Hosting** | Vercel | Global CDN. Zero-config deploys. |
| **External APIs** | NHTSA VIN Decoder | Free. No key. 100% coverage for global vehicle makes/models. |
| **Notifications** | WhatsApp `wa.me` | Zero API cost. 90M+ Nigerian users. Staff-mediated sends. |

---

<br/>

## 🚀 Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/abbassani94/gearshift.git
cd gearshift

# 2. Add your Supabase credentials to js/supabase.js
SUPABASE_URL  = 'https://your-project.supabase.co'
SUPABASE_ANON = 'your-anon-key'

# 3. Add your Paystack public key to js/billing.js
PAYSTACK_PUBLIC_KEY = 'pk_live_your_key'

# 4. Run the SQL migrations in Supabase SQL Editor (in order):
#    → supabase_schema.sql
#    → billing_migration.sql
#    → add_wa_notification_column.sql

# 5. Deploy the two Edge Functions in Supabase Dashboard:
#    → resolve-bank-account/index.ts
#    → create-paystack-subaccount/index.ts

# 6. Set Edge Function secrets:
#    PAYSTACK_SECRET_KEY = sk_live_your_secret_key

# 7. Open app/dashboard.html — register your shop and go
```

> 💡 No build tools, no npm, no Node. Open `dashboard.html` in a browser and it works.

---

<br/>

## 📁 Project Structure

```
gearshift/
│
├── app/                        # All HTML pages
│   ├── dashboard.html          # Login + registration + main dashboard
│   ├── work-orders.html        # Kanban board + job management
│   ├── customers.html          # CRM + vehicle management
│   ├── inventory.html          # Parts catalog + stock levels
│   ├── invoices.html           # Billing + Paystack payments
│   ├── appointments.html       # Calendar + booking management
│   ├── supply-chain.html       # Suppliers + purchase orders
│   ├── notifications.html      # Alert centre
│   ├── reports.html            # Analytics + revenue charts
│   ├── settings.html           # Shop config + billing + booking link
│   ├── staff.html              # Team management + invites
│   ├── booking.html            # PUBLIC booking page (no login)
│   ├── join.html               # Staff invite acceptance
│   └── reset-password.html     # Password reset flow
│
├── js/
│   ├── supabase.js             # Data layer — all GS.* functions
│   ├── rbac.js                 # Auth + role-based access control
│   ├── billing.js              # Paystack subscription + invoice payments
│   ├── main.js                 # UI utilities + VIN decoder
│   └── theme.js                # Dark/light mode
│
├── css/
│   ├── main.css                # Design system + variables
│   └── app.css                 # App shell + component styles
│
└── supabase/
    └── functions/
        ├── resolve-bank-account/index.ts
        └── create-paystack-subaccount/index.ts
```

---

<br/>

## 🏆 Engineering Highlights

> *Things in this codebase worth looking at if you're evaluating it*

**1. Multi-tenancy via PostgreSQL RLS**
Row Level Security policies ensure shops never see each other's data — even if the application code has a bug. Defence in depth.

**2. Zero-dependency architecture**
The entire frontend is ~3,500 lines of vanilla JS split across 4 logical modules. No webpack, no React, no npm. Fast, auditable, portable.

**3. Real-time with Supabase Channels**
Live kanban board, instant notification badges, and real-time stock updates — all via Supabase Realtime subscriptions scoped to the current shop's `shop_id`.

**4. Paystack split payments**
When a customer pays an invoice online, Paystack automatically routes 95% to the shop's bank account and 5% to GearShift — no manual reconciliation, no human in the loop.

**5. Cascade delete with atomicity**
Customer deletion runs a Postgres function (`delete_customer_cascade`) that removes all linked records (work orders → parts → invoices → appointments → vehicles) in a single transaction. Nothing is left orphaned.

**6. VIN decode + NHTSA integration**
Auto-fills vehicle forms from a 17-character VIN using the US DOT's free public API — covering every major vehicle make/model globally including Nigerian-market vehicles.

---

<br/>

## 👨🏽‍💻 Built By

<div align="center">

| | |
|---|---|
| **Abbas Sani Abbas** | Software Engineer · Data Scientist · IT Professional |
| 📧 | abbassani94@gmail.com |

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/abbassaniabbas)
[![GitHub](https://img.shields.io/badge/GitHub-0d1117?style=for-the-badge&logo=github&logoColor=white)](https://github.com/abbassani94)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:abbassani94@gmail.com)

</div>

---

<br/>

## 📄 License

MIT — use it, learn from it, build on it.

---

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=c94b1e,e8a020&height=120&section=footer&animation=fadeIn" width="100%"/>

*GearShift — because every workshop deserves software as hardworking as they are.*

</div>
