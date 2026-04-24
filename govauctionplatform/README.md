# GOV Auction Platform — Backend API

Node.js + TypeScript REST API and real-time bidding server for the Botswana Government Online Auction Platform. Handles auctions, live/sealed bidding via Socket.IO, PayGate payments, item collection, and Keycloak-based RBAC.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Environment Variables](#environment-variables)
7. [External Services Setup](#external-services-setup)
   - [MongoDB](#mongodb)
   - [Redis](#redis)
   - [Keycloak](#keycloak)
8. [Running the Server](#running-the-server)
9. [API Reference](#api-reference)
   - [Auth Routes — `/auth`](#auth-routes----auth)
   - [Open Routes — `/open`](#open-routes----open)
   - [App Routes — `/app`](#app-routes----app)
10. [Authentication & RBAC](#authentication--rbac)
11. [Auction Modes](#auction-modes)
12. [Bid Queue (BullMQ + Socket.IO)](#bid-queue-bullmq--socketio)
13. [Socket.IO Events](#socketio-events)
14. [Payment — PayGate](#payment--paygate)
15. [Collection System](#collection-system)
16. [Elasticsearch](#elasticsearch)
17. [Testing](#testing)
18. [Deployment Notes](#deployment-notes)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| HTTP framework | Express 4 |
| Real-time | Socket.IO 4 |
| Database | MongoDB (Mongoose 7) |
| Job queue | BullMQ 5 (Redis-backed) |
| Distributed locking | Redis (Lua SET NX) |
| Authentication | Keycloak (PKCE + JWKS, BFF pattern) |
| Payment | PayGate |
| Search | Elasticsearch (Bonsai) |
| Push notifications | Firebase Admin SDK |
| ID verification | GOV ID Verification API |
| Livestock registry | BAITS3 API |
| Validation | Joi |
| Testing | Jest + ts-jest + MongoMemoryServer + Supertest |

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│  Frontend (React)                                                       │
│  - PKCE login → /auth/exchange → access token (in-memory)              │
│  - REST calls with Bearer token                                         │
│  - Socket.IO connection with Bearer token on handshake                 │
└──────────┬───────────────────────────────────────────────┬─────────────┘
           │ HTTP                                           │ Socket.IO
           ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Express Server (port 8891)                                           │
│                                                                      │
│  /auth  ──→  Auth Router (BFF: exchange, refresh, logout)            │
│  /open  ──→  Open Router (public + webhook endpoints)                │
│  /app   ──→  App Router  (all protected routes, requirePermission)   │
│                                                                      │
│  Socket.IO  ──→  on('e:2' CREATE_BID) ──→  BullMQ bid queue         │
└──────┬───────────────────────────────────────────────┬───────────────┘
       │                                               │
       ▼                                               ▼
┌─────────────┐   ┌──────────────┐   ┌───────────────────────────────┐
│  MongoDB    │   │  Redis       │   │  Keycloak                     │
│  (Mongoose) │   │  - BullMQ    │   │  - JWKS token verification    │
│             │   │  - Bid locks │   │  - User/role management       │
└─────────────┘   └──────────────┘   └───────────────────────────────┘
                        │
                        ▼
              ┌──────────────────────┐
              │  Bid Worker          │
              │  (BullMQ Worker)     │
              │  - Processes bids    │
              │  - Emits via io      │
              └──────────────────────┘
```

**Key design decisions:**
- **BFF (Backend-for-Frontend):** The backend exchanges PKCE auth codes with Keycloak and stores the refresh token in an `httpOnly` cookie. The frontend only ever receives a short-lived access token.
- **Async bid processing:** Bids are never processed synchronously on the socket event. They are enqueued in BullMQ and processed by a dedicated worker with per-item distributed locking — preventing race conditions under high concurrency.
- **Single-instance socket emissions:** The bid worker holds a direct reference to the `io` (Socket.IO server) instance. If the service is scaled horizontally, this must be replaced with `@socket.io/redis-emitter`.

---

## Project Structure

```
src/
├── index.ts                  # Entry point: HTTP server, Socket.IO, bid worker
├── server.ts                 # Express app + middleware + route mounting
├── globals.ts                # All env vars, constants, enums (EPermission, ESocketEventCode…)
│
├── pre-start/
│   ├── index.ts              # dotenv loader (reads env/<name>.env via --env flag)
│   └── env/
│       ├── development.env   # ← edit this for local development
│       └── production.env
│
├── routes/
│   ├── main/
│   │   ├── app.ts            # Mounts all protected sub-routers under /app
│   │   ├── auth.ts           # Mounts auth-router under /auth
│   │   └── open.ts           # Mounts open-router under /open
│   ├── auth-router.ts        # /auth/config|exchange|refresh|logout
│   ├── open-router.ts        # Public + webhook endpoints
│   ├── auction-router.ts     # /app/auctions/*
│   ├── bid-router.ts         # /app/bids/*
│   ├── collection-router.ts  # /app/collections/*
│   ├── item-router.ts        # /app/items/*
│   ├── transaction-router.ts # /app/transactions/*
│   ├── user-router.ts        # /app/users/*
│   └── ...                   # category, form, forum, message, notification routers
│
├── services/                 # Business logic layer
├── models/                   # Mongoose schemas + discriminators
├── handlers/                 # Socket.IO event handlers
├── workers/
│   └── bid-worker.ts         # BullMQ worker: processes bid jobs
├── queues/
│   └── bid-queue.ts          # BullMQ queue definition + job types
└── shared/
    ├── middleware.ts          # deserializeUser, requirePermission, verifyWebhookSignature
    ├── keycloak.ts            # Keycloak admin API helpers, JWKS, token exchange
    ├── redis.ts               # Shared IORedis connection for BullMQ
    ├── bid-lock.ts            # Distributed bid locking via Redis SET NX + Lua
    ├── errors.ts              # Custom error classes (NotFoundError, ForbiddenError…)
    ├── functions.ts           # Shared utilities (slugs, OTP, PayGate, BAITS helpers…)
    └── sec/
        └── public_key.pem    # RSA public key for webhook signature verification

spec/
├── unit/
│   ├── services/             # Service-layer unit tests (MongoMemoryServer)
│   └── shared/               # bid-crypto, functions tests
├── integration/
│   └── routes/               # Route-level tests (supertest, mocked services)
├── e2e/
│   └── bid-worker.spec.ts    # Full worker flow (mocked BullMQ Worker + MongoMemoryServer)
└── helpers/
    ├── db.ts                 # MongoMemoryServer connect/disconnect/clear
    ├── auth.ts               # signTestToken, mockDeserializeUser
    ├── env.ts                # Test environment variables (loaded via setupFiles)
    └── factories/            # user, auction, item, bid factory builders
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 22.x |
| npm | 10.x |
| MongoDB | 7.x |
| Redis | 7.x |
| Keycloak | 26.x |

---

## Installation

```bash
npm install
```

---

## Environment Variables

The active env file is **`src/pre-start/env/development.env`**. It is loaded at startup by `dotenv` via the `--env` command-line flag (defaults to `development`).

> The root-level `development.env` is a scratch/reference copy — the server does **not** read it.

### Complete variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Node environment |
| `PORT` | No | `3000` | HTTP server port |
| `EXPRESS_SESSION_SECRET` | Yes | — | Session signing secret |
| **Keycloak** | | | |
| `KEYCLOAK_URL` | Yes | — | Keycloak base URL e.g. `http://localhost:8080` |
| `KEYCLOAK_REALM` | No | `auctions` | Keycloak realm name |
| `KEYCLOAK_CLIENT_ID` | Yes | — | Resource-server client ID (`auction-platform-api`) |
| `KEYCLOAK_FRONTEND_CLIENT_ID` | Yes | — | Public PKCE client ID (`auction-platform-frontend`) |
| `KEYCLOAK_ADMIN_CLIENT_ID` | Yes | — | M2M admin client ID (`auction-platform-admin`) |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Yes | — | Admin client secret (from Keycloak UI) |
| **MongoDB** | | | |
| `MONGO_DB_USER` | Atlas only | — | Atlas DB username (local URI is hardcoded) |
| `MONGO_DB_PASS` | Atlas only | — | Atlas DB password |
| **Redis** | | | |
| `REDIS_HOST` | No | `localhost` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASS` | No | — | Redis password (omit if none) |
| **Bidding** | | | |
| `SEALED_BID_ENCRYPTION_KEY` | Yes | — | 64-char hex key for AES-256-GCM sealed bid encryption. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| **PayGate** | | | |
| `PAYGATE_ID` | Yes | — | PayGate merchant ID |
| `PAYGATE_ENCRYPTION_KEY` | Yes | — | PayGate encryption key |
| **Elasticsearch** | | | |
| `ELASTICSEARCH_NODE` | Yes | — | Elasticsearch cluster URL |
| `ELASTICSEARCH_USERNAME` | Yes | — | Elasticsearch username |
| `ELASTICSEARCH_PASSWORD` | Yes | — | Elasticsearch password |
| **Firebase** | | | |
| `FIREBASE_SERVICE_ACCOUNT_CREDENTIALS` | Yes | — | Service account JSON as a single-line string. Download from Firebase Console → Project Settings → Service Accounts → Generate new private key, then flatten: `node -e "console.log(JSON.stringify(require('./sa.json')))"` |
| **External APIs** | | | |
| `BAITS_API_TOKEN` | Yes | — | BAITS3 livestock registry API token |
| `ID_VERIFICATION_API_KEY` | Yes | — | GOV ID verification API key |

### Current state of `src/pre-start/env/development.env`

The file already contains values for `PAYGATE_*`, `ELASTICSEARCH_*`, `SEALED_BID_ENCRYPTION_KEY`, `REDIS_*`, and `EXPRESS_SESSION_SECRET`. The following need to be **updated after the RBAC upgrade**:

```diff
-KEYCLOAK_CLIENT_ID=auction-backend
-KEYCLOAK_CLIENT_SECRET=change-me-in-production
+KEYCLOAK_CLIENT_ID=auction-platform-api
+KEYCLOAK_FRONTEND_CLIENT_ID=auction-platform-frontend
+KEYCLOAK_ADMIN_CLIENT_ID=auction-platform-admin
+KEYCLOAK_ADMIN_CLIENT_SECRET=<paste from Keycloak Clients → auction-platform-admin → Credentials>
+ID_VERIFICATION_API_KEY=<api key>
```

---

## External Services Setup

### MongoDB

The MongoDB connection URI is **hardcoded** in `src/globals.ts`:

```
mongodb://localhost:27017/bwgovauctionplatform?retryWrites=true&w=majority
```

To use MongoDB Atlas instead, uncomment the `mongodb+srv://...` line in `globals.ts` and set `MONGO_DB_USER` / `MONGO_DB_PASS`.

**Local setup (Docker):**
```bash
docker run -d --name mongo -p 27017:27017 mongo:7
```

### Redis

Used by BullMQ (bid job queue) and the distributed bid lock (`bid-lock.ts`).

**Local setup (Docker):**
```bash
docker run -d --name redis -p 6379:6379 redis:7
```

If Redis requires a password, set `REDIS_PASS` in the env file.

### Keycloak

The platform uses a **4-client Keycloak architecture** in the `auctions` realm:

| Client | Type | Purpose |
|---|---|---|
| `auction-platform-frontend` | Public (PKCE) | User login from the browser — no secret |
| `auction-platform-api` | Resource server | Holds client role definitions; validates `aud` claim. No service account |
| `auction-platform-admin` | Confidential (M2M) | Keycloak Admin API calls (create/delete users). Uses `manage-users` role from `realm-management` |
| `admin-cli` | Built-in | Manual/bootstrap use only |

A custom client scope `auction-api-access` bridges the frontend client to the API client via an audience mapper and a client-role mapper, so the frontend's JWT contains the bidder/seller/admin roles assigned in `auction-platform-api`.

**Local setup (Docker):**
```bash
docker run -d --name keycloak \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26 start-dev
```

**Import the realm:**

1. Navigate to `http://localhost:8080` → Admin Console → login with `admin/admin`
2. Click **Create realm** → **Browse** → select `keycloak/auctions-realm.json` → **Create**

The import creates:
- The `auctions` realm
- All 4 clients with correct settings
- 38 client roles on `auction-platform-api` (e.g. `auction:create`, `lot:bid`, `collection:validate`)
- Composite role mappings (e.g. `BIDDER` composite → `lot:bid`, `lot:read`, `collection:read_own`…)

**After import — get the admin client secret:**
1. Clients → `auction-platform-admin` → Credentials tab
2. Copy the client secret → paste into `KEYCLOAK_ADMIN_CLIENT_SECRET` in the env file

**Create the first admin user:**

After the server is running, call the bootstrap endpoint once:
```bash
curl -X POST http://localhost:8891/open/createInitAdmin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin1234!"}'
```

---

## Running the Server

**Development (with hot reload):**
```bash
npm run start:dev
# Uses: nodemon → ts-node -r tsconfig-paths/register ./src
# Loads: src/pre-start/env/development.env
```

**Production build:**
```bash
npm run build   # compiles TypeScript → dist/
npm start       # node -r module-alias/register ./dist --env=production
```

The server starts on port `8891` (set in `src/pre-start/env/development.env`).

On startup it:
1. Loads environment variables
2. Connects to MongoDB
3. Starts the Socket.IO server
4. Starts the BullMQ bid worker

---

## API Reference

All request/response bodies are JSON. All protected routes require a `Bearer <access_token>` header (populated automatically by the frontend's `apiClient` axios instance).

### Auth Routes — `/auth`

No authentication required.

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/config` | Returns Keycloak endpoint URLs for API clients |
| `POST` | `/auth/exchange` | PKCE code exchange. Body: `{ code, codeVerifier, redirectUri }`. Sets `rt` httpOnly cookie. Returns `{ accessToken }` |
| `POST` | `/auth/refresh` | Refresh access token using `rt` httpOnly cookie. Returns `{ accessToken }` |
| `POST` | `/auth/logout` | Revokes refresh token and clears the `rt` cookie |

### Open Routes — `/open`

Public endpoints (no auth) and webhook endpoints (HMAC signature required).

**Public:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/open/createInitAdmin` | Bootstrap: creates the first SuperAdmin (one-time use) |
| `POST` | `/open/createBidder` | Bidder self-registration |
| `GET` | `/open/getItems` | Paginated item listing |
| `GET` | `/open/getAuctions` | Paginated auction listing |
| `GET` | `/open/getItemById` | Single item by `?id=` |
| `GET` | `/open/getItemByTitleSlug` | Single item by `?slug=` |
| `GET` | `/open/getAuctionById` | Single auction by `?id=` |
| `GET` | `/open/getAuctionByTitleSlug` | Single auction by `?slug=` |
| `GET` | `/open/getCategoryById` | Single category by `?id=` |
| `GET` | `/open/getCategories` | All categories |
| `GET` | `/open/search` | Elasticsearch full-text search |
| `POST` | `/open/processSuccessfulPaymentFromPayGate` | PayGate payment webhook (no signature check — PayGate uses a CHECKSUM field instead) |

**Webhooks** (require `x-signature` HMAC header — signed with `src/shared/sec/public_key.pem`):

| Method | Path | Triggered by | Description |
|---|---|---|---|
| `POST` | `/open/trackTransactionStatus` | Cron | Marks stale pending transactions as FAILED |
| `POST` | `/open/trackAuctionStatus` | Cron | Closes auctions past their end time |
| `POST` | `/open/trackItemStatus` | Cron | Closes items, triggers winner selection, initiates non-winner refunds |
| `POST` | `/open/trackCollectionStatus` | Cron | Marks uncollected items as FORFEITED past collection deadline |

### App Routes — `/app`

All protected. Require `Authorization: Bearer <token>` and the corresponding permission (enforced by `requirePermission(EPermission.X)`).

#### `/app/auctions` — Auction management

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/createAuction` | `auction:create` | Create a new auction |
| `DELETE` | `/deleteAuction` | `auction:delete` | Delete an auction |
| `PUT` | `/publishAuction` | `auction:approve` | Publish (approve) an auction |
| `PUT` | `/unpublishAuction` | `auction:unpublish` | Unpublish an auction |
| `PUT` | `/rejectAuction` | `auction:reject` | Reject an auction with a reason |
| `GET` | `/getAllAuctions` | `auction:read` | Paginated auction list |
| `GET` | `/getAuctionReport` | `auction:report` | Auction statistics report |
| `POST` | `/createRequiredAttribute` | `auction:create` | Add a required bidder attribute |
| `GET` | `/getRequiredAttributes` | `auction:read` | List required bidder attributes |
| `PUT` | `/updateAuctionCoordinates` | `auction:create` | Update GPS coordinates |

#### `/app/items` — Lot management

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/createItem` | `lot:create` | Create a new lot/item |
| `DELETE` | `/deleteItem` | `lot:manage` | Delete a lot |
| `GET` | `/getItemsWon` | `lot:read` | Items won by the authenticated bidder |
| `GET` | `/getManualBidAmount` | `lot:bid_read` | Current manual bid price for a lot |
| `PUT` | `/setWinningBidder` | `lot:manage` | Manually set the winning bidder |
| `PUT` | `/setNewBidAmountManually` | `lot:manage` | Set the current price (Mode 2 livestream) |
| `GET` | `/getEligibleBidders` | `lot:manage` | List bidders eligible to bid on a lot |

#### `/app/bids` — Bid history

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/getBids` | `lot:bid_read` | Paginated bid list for a lot |

> Bids are **placed via Socket.IO** (`e:2 CREATE_BID`), not via HTTP.

#### `/app/transactions` — Payments

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/initiateItemReservation` | `transaction:reserve` | Start a PayGate deposit (reservation) to enter bidding |
| `POST` | `/initiatePurchaseItemByWinningBidder` | `transaction:purchase` | Winner initiates PayGate purchase |
| `POST` | `/initiatePurchaseItemUsingBuyoutPrice` | `transaction:purchase` | Buyout price purchase |
| `GET` | `/getTransactions` | `transaction:read` | Paginated transaction list |

#### `/app/collections` — Item collection

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/validateCollectionCode` | `collection:validate` | Seller validates buyer's 8-digit OTP |
| `POST` | `/raiseDispute` | `collection:dispute` | Buyer raises a dispute on a collection |
| `PUT` | `/resolveDispute` | `collection:resolve` | Admin resolves a dispute |
| `POST` | `/initiateDisputeRefund` | `collection:refund` | Admin initiates a refund for a disputed collection |
| `GET` | `/getByItemId` | `collection:read` | Get collection record for an item |
| `GET` | `/getCollections` | `collection:read` | Paginated collection list |
| `GET` | `/getMyCollection` | `collection:read_own` | Authenticated buyer's collection for an item |
| `POST` | `/resendCollectionOtp` | `collection:otp_resend` | Resend collection OTP to buyer |

#### `/app/users` — User management

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/getUserById` | `user:read` | Get any user by ID |
| `GET` | `/getOwnAccount` | — | Get the authenticated user's own account |
| `GET` | `/getUsers` | `user:manage` | Paginated user list |
| `POST` | `/createSeller` | `user:manage` | Admin creates a seller (welcome email sent) |
| `POST` | `/createAuctionApprover` | `user:approver_manage` | Create an auction approver user |
| `GET` | `/getAuctionApprovers` | `user:approver_read` | List auction approvers for a seller |
| `PUT` | `/updateAuctionApproverStatus` | `user:approver_manage` | Enable/disable an approver |
| `DELETE` | `/deleteAdminById` | `user:delete` | Delete an admin user |
| `PUT` | `/updatePassword` | — | Update own password via Keycloak |
| `PUT` | `/setFirebaseTokenId` | — | Register FCM push token |
| `GET` | `/getUserReport` | `user:report` | User statistics report |
| `PUT` | `/verifyIdentityNumber` | — | Trigger GOV ID verification |
| `POST` | `/beginBAITSKeeperIDVerification` | — | Start BAITS livestock keeper verification |
| `POST` | `/finishBAITSKeeperIDVerification` | — | Complete BAITS verification |

---

## Authentication & RBAC

### Flow

```
Browser → PKCE redirect → Keycloak login page
       ← redirect with ?code=
Browser → POST /auth/exchange { code, codeVerifier, redirectUri }
       ← { accessToken } + Set-Cookie: rt=<refresh_token>; HttpOnly; SameSite=Strict
Browser stores accessToken in memory only (never localStorage)
All API calls: Authorization: Bearer <accessToken>
On 401: POST /auth/refresh (cookie sent automatically) → new accessToken
```

### Permission model

38 fine-grained permissions are defined in `EPermission` in `src/globals.ts`, e.g.:

```
auction:create   auction:delete    auction:approve   auction:reject
lot:create       lot:manage        lot:bid           lot:bid_read
transaction:reserve  transaction:purchase  transaction:read
collection:validate  collection:dispute   collection:refund
user:manage      user:read         user:delete       user:report
```

Permissions are assigned to Keycloak **client roles** on `auction-platform-api`. Each user type has a composite role:

| User type | Key permissions |
|---|---|
| `BIDDER` | `lot:bid`, `lot:read`, `lot:bid_read`, `transaction:reserve`, `transaction:purchase`, `collection:read_own`, `collection:dispute` |
| `SELLER` | `lot:create`, `lot:manage`, `auction:create`, `collection:validate`, `collection:otp_resend` |
| `ADMIN` (SuperAdmin) | All permissions |
| `AUCTION_APPROVER` | `auction:approve`, `auction:reject`, `auction:read` |

On each request, `deserializeUser` middleware:
1. Verifies the JWT signature against Keycloak's JWKS endpoint
2. Validates the `aud` claim equals `KEYCLOAK_CLIENT_ID`
3. Extracts `realm_access.roles` → `req.roles`
4. Extracts `resource_access[auction-platform-api].roles` → `req.permissions`
5. Looks up the MongoDB user by `payload.sub` (Keycloak user ID) → `req.user`

---

## Auction Modes

Three bidding modes are set per-item at creation time and never change:

| Mode | Flags | Behaviour |
|---|---|---|
| **Mode 1 — Open** | `isClosedBidding=false`, `isBidIncrementedManually=false` | Free bids; live running total broadcast to all; bid retraction allowed |
| **Mode 2 — Livestream** | `isBidIncrementedManually=true` | Auctioneer calls price via `e:13 CREATE_NEW_MANUAL_BID_AMOUNT`; single "I Bid" button; no retraction |
| **Mode 3 — Sealed** | `isClosedBidding=true` | Encrypted bids; bidder submits once; no running total shown; all bids revealed at close |

---

## Bid Queue (BullMQ + Socket.IO)

Bids are **never processed synchronously** on the socket event. The flow is:

```
Client emits  e:2 CREATE_BID  { itemId, bidAmount }
                    │
                    ▼
Server acks   202 ACCEPTED   { jobId }   ← client shows spinner
                    │
                    ▼
         bidQueue.add('bid', { socketId, bidderId, input })
                    │
                    ▼
         BullMQ Worker (bid-worker.ts)
           1. Acquire Redis SET NX lock for itemId  (5s TTL)
           2. Fetch Bidder from MongoDB
           3. Fetch Item → detect mode
           4. Call bidService.createOpenBid / createLivestreamBid / createSealedBid
           5. Record BidEvent (fire-and-forget)
           6. Emit to item room + bidder private room
           7. Release lock
                    │
                    ▼
Client receives  e:20 BID_RESULT  { status: 'accepted'|'rejected', bidId?, error? }
```

**Error handling:**
- `ForbiddenError` / `NotFoundError` → `UnrecoverableError` (no retry). Bidder receives `BID_RESULT { status: 'rejected' }`.
- Any other error (network, transient) → rethrown. BullMQ retries 3× with exponential backoff starting at 1s. Bidder continues seeing spinner until a retry succeeds.
- Lock contention → plain `Error` thrown → BullMQ retries after backoff.

**Scaling note:** The worker holds a direct reference to the `io` (Socket.IO server) instance. For horizontal scaling (multiple replicas), replace `io.to(room).emit(...)` with `@socket.io/redis-emitter` and add `@socket.io/redis-adapter` to the Socket.IO server.

---

## Socket.IO Events

Authentication is required on the Socket.IO handshake:
```js
const socket = io(SERVER_URL, {
  auth: { authorization: `Bearer ${accessToken}` }
});
```

| Code | Event name | Direction | Payload | Description |
|---|---|---|---|---|
| `e:1` | `JOIN_BIDDING_ROOM` | Client → Server | `itemId: string` | Join a lot's bidding room |
| `e:2` | `CREATE_BID` | Client → Server | `{ itemId, bidAmount, idempotencyKey? }` | Place a bid (enqueues job, ACKs 202) |
| `e:3` | `UPDATE_BID_AMOUNT` | Server → Room | `bidAmount: number` | New leading bid price (Mode 1 & 2) |
| `e:7` | `POLL_PAID_TRANSACTION` | Client → Server | `{ transactionId }` | Poll a pending PayGate transaction |
| `e:11` | `RETRACT_BID` | Client → Server | `bidId: string` | Retract a bid (Mode 1 only) |
| `e:12` | `RETRACTED_BID` | Server → Room | `bidId: string` | Broadcast retracted bid ID |
| `e:13` | `CREATE_NEW_MANUAL_BID_AMOUNT` | Client → Server | `{ itemId, amount }` | Auctioneer sets price (Mode 2) |
| `e:14` | `BROADCAST_NEW_MANUAL_BID_AMOUNT` | Server → Room | `amount: number` | Broadcast new manual price |
| `e:15` | `REFRESH_AFTER_WINNING` | Client → Server | `{ itemId }` | Signal item sold |
| `e:16` | `BROADCAST_REFRESH_AFTER_WINNING` | Server → Room | `itemId` | Broadcast item sold to all in room |
| `e:17` | `MOVE_AUDIENCE_TO_ITEM` | Client → Server | `{ currentItemId, nextItemId }` | Move livestream audience |
| `e:18` | `BROADCAST_MOVE_AUDIENCE_TO_ITEM` | Server → Room | `nextItemId` | Broadcast audience redirect |
| `e:19` | `SEALED_BID_ACCEPTED` | Server → Room | *(no payload)* | Sealed bid count incremented (amount hidden) |
| `e:20` | `BID_RESULT` | Server → Socket | `{ status, bidId?, error? }` | Private bid outcome for the placing bidder |

**Room naming convention:**
- Bidding room: `${itemId}-bid`
- Chat room: `${itemId}-chat`
- Forum room: `${forumId}-forum`
- Private bidder room: `${socket.id}` (used for BID_RESULT)

---

## Payment — PayGate

PayGate is the sole payment provider. All UniPay / Tingg integrations have been removed.

**Transaction types:**

| Type | Description |
|---|---|
| `RESERVATION` | Deposit paid by a bidder to gain eligibility to bid on a lot |
| `PURCHASE` | Final payment by the winning bidder for a lot |
| `REFUND` | Issued to non-winners (RESERVATION refund) or dispute resolution (PURCHASE refund) |

**Payment flow:**
1. Bidder calls `POST /app/transactions/initiateItemReservation` → server initiates PayGate payment, returns a payment URL
2. Bidder completes payment on PayGate's hosted page
3. PayGate POSTs to `POST /open/processSuccessfulPaymentFromPayGate` with CHECKSUM verification
4. On `TRANSACTION_STATUS=1` (approved): transaction marked COMPLETED, bidder added to eligible bidders list; if PURCHASE, `createCollection` is called fire-and-forget
5. Non-winner RESERVATION refunds are triggered automatically by `trackItemStatus` cron

`PAY_REQUEST_ID` is stored in `transaction.metadata` for all transactions to enable future refund API calls.

---

## Collection System

After a winning bidder's PURCHASE transaction completes, a `Collection` document is created automatically.

**Status machine:**
```
AWAITING_COLLECTION
     │
     ├──→ COLLECTED         (seller validates OTP via /app/collections/validateCollectionCode)
     │
     ├──→ FORFEITED         (trackCollectionStatus cron: deadline passed, no collection)
     │
     └──→ DISPUTED          (buyer raises dispute via /app/collections/raiseDispute)
              │
              └──→ RESOLVED (admin resolves + optionally initiates refund)
```

**Collection deadline:** Created date + `auction.collectionWindowDays` working days (Mon–Fri), with the cutoff time set to `auction.collectionEndTime` (e.g. `17:00`).

**OTP:** An 8-digit numeric code is generated at collection creation, SHA-256 hashed (salted with `itemId`), and stored hashed. The plain code is delivered to the buyer via push notification and email — it is **never stored in plain text** and never returned via the API.

---

## Elasticsearch

Item documents are indexed in Elasticsearch for full-text search via `GET /open/search`. The `elasticsearch-service.ts` service handles:
- `indexItem` — called on item creation
- `updateItemsWithAuction` — called on auction save (via Mongoose post-save hook)
- `deleteItem` — called on item deletion
- `searchItems` — powers the `/open/search` endpoint

---

## Testing

The test suite uses **Jest + ts-jest** with 484 tests across 17 suites.

```bash
npm test                           # run all tests
npm run test:watch                 # watch mode
npm run test:coverage              # with coverage report
npx jest --testPathPattern=routes  # run only route integration tests
npx jest --testPathPattern=e2e     # run only E2E tests
```

**Test layout:**

| Suite type | Location | What it tests |
|---|---|---|
| Unit — services | `spec/unit/services/` | Business logic against MongoMemoryServer (no HTTP) |
| Unit — shared | `spec/unit/shared/` | Utility functions, bid encryption |
| Integration — routes | `spec/integration/routes/` | HTTP layer: status codes, Joi validation, permission guards, error mapping |
| E2E | `spec/e2e/` | Full bid worker flow: mode routing, socket emissions, lock lifecycle, error handling |

**Key patterns:**
- `spec/helpers/db.ts` — `connectTestDb()` (single node) / `connectTestDbReplSet()` (replica set, for transactions)
- `spec/helpers/auth.ts` — `signTestToken(permissions, roles)` generates RS256 JWTs for route tests
- `spec/helpers/env.ts` — loaded via `setupFiles`, sets all `process.env` before any test runs
- `spec/helpers/factories/` — builder functions for User, Auction, Item, Bid test data
- Route tests mock the entire service layer — they test routing/validation/auth only
- The bid worker E2E test mocks the BullMQ `Worker` class to capture the processor function and invoke it directly (avoiding the need for a real Redis during CI)

---

## Deployment Notes

- **MongoDB URI** is hardcoded in `src/globals.ts`. For Atlas, uncomment the `mongodb+srv://` line and set `MONGO_DB_USER` / `MONGO_DB_PASS`.
- **`src/shared/sec/public_key.pem`** must be present. This RSA public key is used to verify the HMAC signature on inbound cron webhooks.
- **Firebase credentials** are stored in `FIREBASE_SERVICE_ACCOUNT_CREDENTIALS` (env var). The service account JSON must be provided as a single-line string. See the env vars table above.
- **Sealed bid key**: `SEALED_BID_ENCRYPTION_KEY` must be a cryptographically random 64-character hex string. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Changing this key in production will make all existing sealed bids unreadable.
- **Horizontal scaling**: The bid worker emits Socket.IO events directly via the `io` reference. Before scaling to multiple instances, add `@socket.io/redis-adapter` to the Socket.IO server and replace direct `io.to().emit()` calls in `bid-worker.ts` with a `@socket.io/redis-emitter` instance.
- **CORS**: `SERVICE_URLS.clientURI` in `src/globals.ts` is hardcoded to `https://auctiondev.xyz`. Update for your domain.
- **`ESCAPE_HTTP_ORIGIN_SOCKET_IO`** in `src/globals.ts` is set to `http://localhost:3000` — this origin bypasses Socket.IO auth. Remove or restrict before production.
