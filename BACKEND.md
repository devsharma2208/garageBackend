# Garage Sale Backend — Architecture & API Reference

> **Stack:** Node.js · Express.js · MongoDB · Mongoose · JWT · Multer · Nodemailer · Winston

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [MVC Architecture Graph](#mvc-architecture-graph)
3. [Request Lifecycle Flow](#request-lifecycle-flow)
4. [Authentication Flow](#authentication-flow)
5. [OTP / Password Reset Flow](#otp--password-reset-flow)
6. [JWT Token Strategy](#jwt-token-strategy)
7. [Database Schema](#database-schema)
8. [Entity Relationship Diagram](#entity-relationship-diagram)
9. [API Endpoint Map](#api-endpoint-map)
10. [Middleware Pipeline](#middleware-pipeline)
11. [Image Upload Flow](#image-upload-flow)
12. [Geospatial Query Flow](#geospatial-query-flow)
13. [Error Handling Graph](#error-handling-graph)
14. [Environment Variables](#environment-variables)
15. [Quick Start](#quick-start)

---

## Project Structure

```
garage-backend/
│
├── server.js                   ← Entry point — connects DB then starts HTTP server
├── .env                        ← Secrets (never commit)
├── .env.example                ← Template for environment setup
├── .gitignore
├── package.json
├── logs/                       ← Winston log files (auto-created)
├── uploads/                    ← Multer uploaded images (auto-created)
│
└── src/
    ├── app.js                  ← Express app (middleware stack + routes)
    │
    ├── config/
    │   ├── db.js               ← Mongoose connect / disconnect events
    │   └── env.js              ← Validates required env vars on boot
    │
    ├── models/                 ← Mongoose schemas (M in MVC)
    │   ├── User.js
    │   ├── Sale.js
    │   └── PasswordReset.js
    │
    ├── controllers/            ← Business logic (C in MVC)
    │   ├── authController.js
    │   ├── saleController.js
    │   └── userController.js
    │
    ├── routes/                 ← Express routers + validation rules (V→C bridge)
    │   ├── authRoutes.js
    │   ├── saleRoutes.js
    │   └── userRoutes.js
    │
    ├── middleware/             ← Reusable middleware
    │   ├── authMiddleware.js   ← JWT protect / optional
    │   ├── errorHandler.js     ← Global error handler + ApiError class
    │   └── validate.js         ← express-validator result checker
    │
    └── utils/                  ← Helpers / services
        ├── jwt.js              ← Token generation & verification
        ├── email.js            ← Nodemailer OTP sender
        ├── response.js         ← Standardised success/error JSON
        └── logger.js           ← Winston logger (console + file)
```

---

## MVC Architecture Graph

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT (React Native)                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │  HTTP Request
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          server.js                                  │
│   connectDB() ──► app.listen(PORT)                                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           src/app.js                                │
│                                                                     │
│  helmet ─► cors ─► compression ─► morgan ─► express.json           │
│  ─► mongoSanitize ─► globalRateLimit ─► authRateLimit              │
│                                                                     │
│  /uploads  ──────────────────────────────► Static files            │
│  /api/auth ──────────────────────────────► authRoutes              │
│  /api/sales ─────────────────────────────► saleRoutes              │
│  /api/users ─────────────────────────────► userRoutes              │
│  /health   ──────────────────────────────► Health check            │
└─────────────┬──────────────┬──────────────┬────────────────────────┘
              │              │              │
              ▼              ▼              ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────┐
│   ROUTES (V)    │ │  ROUTES (V)  │ │  ROUTES (V)  │
│  authRoutes.js  │ │ saleRoutes.js│ │ userRoutes.js│
│                 │ │              │ │              │
│ express-validator│ │   multer     │ │   multer     │
│ validate()      │ │ validate()   │ │              │
└────────┬────────┘ └──────┬───────┘ └──────┬───────┘
         │                 │                │
         ▼                 ▼                ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────┐
│  CONTROLLERS (C)│ │ CONTROLLERS  │ │ CONTROLLERS  │
│ authController  │ │ saleController│ │ userController│
│                 │ │              │ │              │
│ register        │ │ getSales     │ │ getProfile   │
│ login           │ │ getTrending  │ │ updateProfile│
│ logout          │ │ getEndingSoon│ │ getUserSales │
│ refreshToken    │ │ getNearbySales│ │ getSavedSales│
│ getMe           │ │ getStats     │ │ saveSale     │
│ forgotPassword  │ │ getSale      │ │ unsaveSale   │
│ verifyOTP       │ │ createSale   │ │ getUserStats │
│ resetPassword   │ │ updateSale   │ └──────┬───────┘
└────────┬────────┘ │ deleteSale   │        │
         │          └──────┬───────┘        │
         │                 │                │
         └────────┬─────────┘────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          MODELS (M)                                 │
│                                                                     │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│   │   User.js    │   │   Sale.js    │   │  PasswordReset.js    │   │
│   │              │   │              │   │                      │   │
│   │ bcrypt hash  │   │ 2dsphere idx │   │  TTL auto-expire     │   │
│   │ comparePass()│   │ GeoJSON loc  │   │  (10 min)            │   │
│   │ toJSON clean │   │ virtual isLive│   │                      │   │
│   └──────┬───────┘   └──────┬───────┘   └──────────────────────┘   │
│          │                  │                                        │
└──────────┼──────────────────┼────────────────────────────────────────┘
           │                  │
           ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MongoDB Atlas / Local                            │
│                                                                     │
│   Collections:  users   ·   sales   ·   passwordresets             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Request Lifecycle Flow

```
Client Request
     │
     ▼
 ┌────────────────────────────────────────────────────────────┐
 │                    Middleware Stack                        │
 │                                                            │
 │  1. helmet()          ← Security headers                   │
 │  2. cors()            ← Cross-origin control               │
 │  3. compression()     ← Gzip responses                     │
 │  4. morgan()          ← HTTP logging → Winston             │
 │  5. express.json()    ← Parse JSON body                    │
 │  6. mongoSanitize()   ← Strip $ and . from input           │
 │  7. rateLimit()       ← Throttle 200 req / 15 min          │
 └──────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                       Router Layer                          │
 │                                                              │
 │  Match route ──► Run route-specific middleware:              │
 │    • express-validator rules                                 │
 │    • validate() ← returns 400 if invalid                    │
 │    • authMiddleware.protect() ← verifies JWT                │
 │    • multer.upload() ← parses multipart images              │
 └──────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                    Controller Function                      │
 │                                                              │
 │  try {                                                       │
 │    ── Query / mutate Models                                  │
 │    ── Call utils (jwt, email, response)                      │
 │    ── return success(res, data, message, statusCode)         │
 │  } catch (err) {                                             │
 │    next(err) ──► errorHandler middleware                     │
 │  }                                                           │
 └──────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │   JSON Response      │
                 │                      │
                 │  { success: true,    │
                 │    message: "...",   │
                 │    data: { ... } }   │
                 └──────────────────────┘
```

---

## Authentication Flow

```
                        ┌───────────────┐
                        │    CLIENT     │
                        └───────┬───────┘
                                │
                   ┌────────────▼────────────┐
                   │   POST /api/auth/login  │
                   │   { email, password }   │
                   └────────────┬────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │         authController.login()     │
              │                                    │
              │  1. findOne({ email })             │
              │     .select('+password +tokens')   │
              │                                    │
              │  2. bcrypt.compare(pwd, hash)      │
              │     ✗ ──► 401 Invalid credentials  │
              │                                    │
              │  3. generateAccessToken(userId)    │
              │     ↳ JWT signed, expires: 15m     │
              │                                    │
              │  4. generateRefreshToken(userId)   │
              │     ↳ JWT signed, expires: 7d      │
              │                                    │
              │  5. Store refreshToken in DB       │
              │     (keep last 5)                  │
              └─────────────────┬──────────────────┘
                                │
                   ┌────────────▼────────────┐
                   │  200 { user,            │
                   │        accessToken,     │
                   │        refreshToken }   │
                   └────────────┬────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │           CLIENT STORES             │
              │                                    │
              │  AsyncStorage:                     │
              │    accessToken  ← attached to      │
              │    refreshToken   every request    │
              │    user (JSON)                     │
              └─────────────────┬──────────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │     Subsequent Protected Request   │
              │                                    │
              │  Header: Authorization: Bearer     │
              │          <accessToken>             │
              │                                    │
              │  authMiddleware.protect():         │
              │    verifyAccessToken(token)        │
              │    ✗ expired ──► 401               │
              │    ✓ valid  ──► req.user = user    │
              │                 next()             │
              └────────────────────────────────────┘

                      Token Refresh Flow
                      ─────────────────
  accessToken expires (401)
         │
         ▼
  Axios interceptor catches 401
         │
         ▼
  POST /api/auth/refresh-token { refreshToken }
         │
         ▼
  Verify refreshToken against DB
  Rotate: delete old, issue new pair
         │
         ▼
  Retry original request with new accessToken
```

---

## OTP / Password Reset Flow

```
  ┌──────────┐     POST /api/auth/forgot-password     ┌──────────────────┐
  │  Client  │ ─────────────────────────────────────► │  authController  │
  │          │  { email }                              │                  │
  └──────────┘                                         │ 1. Find user by  │
                                                       │    email (404?)  │
                                                       │                  │
                                                       │ 2. Delete old    │
                                                       │    OTPs for email│
                                                       │                  │
                                                       │ 3. generateOTP() │
                                                       │    6-digit random│
                                                       │                  │
                                                       │ 4. bcrypt.hash() │
                                                       │    (salt 8)      │
                                                       │                  │
                                                       │ 5. Save to DB    │
                                                       │    expiresAt +10m│
                                                       │                  │
                                                       │ 6. sendOTPEmail()│
                                                       │    Nodemailer    │
                                                       └────────┬─────────┘
                                                                │ 200 OK
  ┌──────────┐     POST /api/auth/verify-otp           ┌────────▼─────────┐
  │  Client  │ ─────────────────────────────────────► │  authController  │
  │  { email,│                                         │                  │
  │    otp } │                                         │ 1. Find record   │
  └──────────┘                                         │    (verified=F,  │
                                                       │     not expired) │
                                                       │                  │
                                                       │ 2. bcrypt.compare│
                                                       │    ✗ ──► 400     │
                                                       │                  │
                                                       │ 3. record.       │
                                                       │    verified=true │
                                                       └────────┬─────────┘
                                                                │ 200 OK
  ┌──────────┐     POST /api/auth/reset-password        ┌───────▼──────────┐
  │  Client  │ ─────────────────────────────────────► │  authController   │
  │  { email,│                                         │                   │
  │  password│                                         │ 1. Find verified  │
  │  }       │                                         │    & non-expired  │
  └──────────┘                                         │    OTP record     │
                                                       │                   │
                                                       │ 2. user.password  │
                                                       │    = newPassword  │
                                                       │    (pre-save hook │
                                                       │     bcrypt hashes)│
                                                       │                   │
                                                       │ 3. Delete all OTPs│
                                                       │    for email      │
                                                       └───────────────────┘
                                                               200 OK
```

---

## JWT Token Strategy

```
┌────────────────────────────────────────────────────────────────┐
│                     Two-Token Strategy                         │
│                                                                │
│  ┌──────────────────────────┐  ┌──────────────────────────┐   │
│  │     ACCESS TOKEN         │  │     REFRESH TOKEN        │   │
│  │                          │  │                          │   │
│  │  Signed: JWT_ACCESS_SEC  │  │  Signed: JWT_REFRESH_SEC │   │
│  │  Expires: 15 minutes     │  │  Expires: 7 days         │   │
│  │  Payload: { id: userId } │  │  Payload: { id: userId } │   │
│  │  Stored: Client memory   │  │  Stored: AsyncStorage    │   │
│  │          AsyncStorage    │  │          + MongoDB        │   │
│  │                          │  │          (max 5 per user) │   │
│  │  Sent in: Authorization  │  │  Sent in: POST body only │   │
│  │    Bearer header         │  │                          │   │
│  └──────────────────────────┘  └──────────────────────────┘   │
│                                                                │
│  Rotation:  On each refresh, old token removed from DB,        │
│             new pair issued. Prevents token reuse attacks.     │
│                                                                │
│  Revocation: logout() removes refresh token from DB array.     │
└────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### User Collection

```
┌─────────────────────────────────────────────────────────────────┐
│                         users                                   │
├──────────────────┬────────────────┬───────────────┬────────────┤
│ Field            │ Type           │ Constraints   │ Index      │
├──────────────────┼────────────────┼───────────────┼────────────┤
│ _id              │ ObjectId       │ auto          │ PK         │
│ firstName        │ String         │ required      │            │
│ lastName         │ String         │ required      │            │
│ email            │ String         │ required      │ unique     │
│ password         │ String         │ required,     │            │
│                  │                │ select:false  │            │
│ phone            │ String         │ optional      │            │
│ avatarUrl        │ String         │ optional      │            │
│ city             │ String         │ optional      │            │
│ location         │ GeoJSON Point  │ [lng, lat]    │ 2dsphere   │
│ bio              │ String         │ max 500       │            │
│ rating           │ Number         │ 0–5           │            │
│ ratingCount      │ Number         │ default 0     │            │
│ sellerBadge      │ String         │ 'New Seller'  │            │
│ isVerified       │ Boolean        │ default false │            │
│ savedSales       │ ObjectId[]     │ ref: Sale     │            │
│ refreshTokens    │ String[]       │ select:false  │            │
│ createdAt        │ Date           │ auto          │            │
│ updatedAt        │ Date           │ auto          │            │
├──────────────────┼────────────────┼───────────────┼────────────┤
│ VIRTUAL          │ fullName       │ firstName +   │            │
│                  │                │ lastName      │            │
└──────────────────┴────────────────┴───────────────┴────────────┘
  Hooks:  pre('save') → bcrypt.hash(password, 10)
  Method: comparePassword(candidate) → Boolean
```

### Sale Collection

```
┌─────────────────────────────────────────────────────────────────┐
│                          sales                                  │
├──────────────────┬────────────────┬───────────────┬────────────┤
│ Field            │ Type           │ Constraints   │ Index      │
├──────────────────┼────────────────┼───────────────┼────────────┤
│ _id              │ ObjectId       │ auto          │ PK         │
│ title            │ String         │ required      │            │
│ description      │ String         │ required      │            │
│ address          │ String         │ required      │            │
│ city             │ String         │ required      │ 1          │
│ location         │ GeoJSON Point  │ [lng, lat]    │ 2dsphere   │
│ startTime        │ Date           │ required      │            │
│ endTime          │ Date           │ required      │ 1          │
│ images           │ String[]       │ URLs/paths    │            │
│ categories       │ String[]       │ optional      │            │
│ seller           │ ObjectId       │ ref: User     │ 1          │
│ isActive         │ Boolean        │ default true  │ compound   │
│ views            │ Number         │ default 0     │ -1         │
│ createdAt        │ Date           │ auto          │ -1         │
│ updatedAt        │ Date           │ auto          │            │
├──────────────────┼────────────────┼───────────────┼────────────┤
│ VIRTUAL          │ isLive         │ isActive &&   │            │
│                  │                │ now in range  │            │
└──────────────────┴────────────────┴───────────────┴────────────┘
  Compound index: { isActive: 1, endTime: 1 }
```

### PasswordReset Collection

```
┌─────────────────────────────────────────────────────────────────┐
│                      passwordresets                             │
├──────────────────┬────────────────┬───────────────┬────────────┤
│ Field            │ Type           │ Constraints   │ Index      │
├──────────────────┼────────────────┼───────────────┼────────────┤
│ _id              │ ObjectId       │ auto          │ PK         │
│ email            │ String         │ required      │ 1          │
│ otp              │ String         │ bcrypt hashed │            │
│ expiresAt        │ Date           │ default +10m  │ TTL        │
│ verified         │ Boolean        │ default false │            │
│ createdAt        │ Date           │ auto          │            │
└──────────────────┴────────────────┴───────────────┴────────────┘
  TTL index: expiresAfterSeconds: 0  → MongoDB auto-deletes
```

---

## Entity Relationship Diagram

```
┌────────────────────────┐         ┌────────────────────────┐
│         User           │         │          Sale          │
│────────────────────────│         │────────────────────────│
│ _id (PK)               │         │ _id (PK)               │
│ firstName              │         │ title                  │
│ lastName               │ 1       │ description            │
│ email (unique)         ├────────►│ address                │
│ password (hashed)      │ creates │ city                   │
│ phone                  │  many   │ location (GeoJSON)     │
│ avatarUrl              │         │ startTime              │
│ city                   │         │ endTime                │
│ location (GeoJSON)     │         │ images[]               │
│ bio                    │         │ categories[]           │
│ rating                 │         │ seller (FK → User)     │
│ ratingCount            │         │ isActive               │
│ sellerBadge            │         │ views                  │
│ isVerified             │         └────────────────────────┘
│ savedSales[] (FK[])    │◄───────────────────┐
│ refreshTokens[]        │  M       saved by  │ M
└────────────────────────┘  saves             │
                                              │
                            ┌─────────────────┘
                            │
                     ┌──────┴──────────────────┐
                     │     PasswordReset       │
                     │─────────────────────────│
                     │ _id (PK)                │
                     │ email (FK by value)     │
                     │ otp (hashed)            │
                     │ expiresAt               │
                     │ verified                │
                     └─────────────────────────┘
```

---

## API Endpoint Map

```
BASE URL:  http://localhost:5000/api
─────────────────────────────────────────────────────────────────────

 AUTH  (/api/auth)
 ─────────────────────────────────────────────────────────────────
  POST    /register          → Create account + return JWT pair
  POST    /login             → Verify credentials + return JWT pair
  POST    /logout            → Revoke refresh token from DB
  POST    /refresh-token     → Rotate access + refresh tokens
  GET     /me                → Return authenticated user (populate saved)
  POST    /forgot-password   → Generate OTP, send email
  POST    /verify-otp        → Compare OTP hash, mark verified
  POST    /reset-password    → Hash new password, clear OTPs

 SALES  (/api/sales)
 ─────────────────────────────────────────────────────────────────
  GET     /                  → List with filters:
  │                            ?city=Austin
  │                            &search=furniture
  │                            &sort=trending|latest|ending-soon|
  │                            │     most-viewed|popular|nearby
  │                            &active=true
  │                            &page=1&limit=20
  │                            &categories=Furniture,Books
  │
  GET     /trending           → Top 10 by views (active only)
  GET     /ending-soon        → Ending within 24h (sorted ASC)
  GET     /nearby             → ?lat=30.26&lng=-97.74&maxDistance=50000
  │                             $nearSphere geospatial query (meters)
  GET     /stats              → { liveSales, endingSoon } counts
  GET     /:id                → Single sale + views++ (async)
  POST    /                  🔒 Create sale (multipart/form-data)
  │                             fields: title, description, address,
  │                             city, latitude, longitude,
  │                             startTime, endTime, categories (JSON)
  │                             images[] (max 5, max 5MB each)
  PUT     /:id               🔒 Update sale (owner only)
  DELETE  /:id               🔒 Delete sale (owner only)

 USERS  (/api/users)
 ─────────────────────────────────────────────────────────────────
  GET     /:id               → Public user profile
  GET     /:id/sales         → User's sale listings (paginated)
  │                            ?page=1&limit=10&active=true
  GET     /:id/stats         → { salesCount, savedCount, rating }
  PUT     /me                🔒 Update own profile
  │                            fields: firstName, lastName, phone,
  │                            city, bio, latitude, longitude
  │                            avatar (single image upload)
  GET     /me/saved          🔒 Get all saved sales (populated)
  POST    /me/saved/:saleId  🔒 Save a sale
  DELETE  /me/saved/:saleId  🔒 Remove from saved

 🔒 = Requires  Authorization: Bearer <accessToken>
```

---

## Middleware Pipeline

```
Every Request
     │
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │              Global Middleware (app.js)                      │
 │                                                              │
 │   helmet()          → X-Frame, HSTS, CSP headers            │
 │       │                                                      │
 │   cors({ origin })  → Allow configured origin               │
 │       │                                                      │
 │   compression()     → Gzip if client accepts                │
 │       │                                                      │
 │   morgan()          → Log to Winston combined.log            │
 │       │                                                      │
 │   express.json()    → Parse application/json body           │
 │       │                                                      │
 │   mongoSanitize()   → Remove $, . from req.body/query       │
 │       │                                                      │
 │   globalRateLimit() → 200 req / 15 min per IP               │
 │       │                                                      │
 │   authRateLimit()   → 20 req / 15 min on /api/auth only     │
 └──────────────────────────────────────────────────────────────┘
     │
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │           Route-Level Middleware (per router)                │
 │                                                              │
 │   [body(...).isEmail()]   → express-validator rules         │
 │       │                                                      │
 │   validate()              → Check validationResult()        │
 │       │                   → 400 { errors[] } if invalid     │
 │       │                                                      │
 │   protect()               → JWT verify → req.user           │
 │       │                   → 401 if missing/expired          │
 │       │                                                      │
 │   upload.array('images')  → multer diskStorage              │
 │                           → 400 if not image/size > 5MB     │
 └──────────────────────────────────────────────────────────────┘
     │
     ▼
 Controller Function
     │
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │              Error Handler (app.js — last)                  │
 │                                                              │
 │   ValidationError     → 400  (Mongoose schema fail)         │
 │   code 11000          → 400  "Email already exists"         │
 │   JsonWebTokenError   → 401  "Invalid token"                │
 │   TokenExpiredError   → 401  "Token expired"                │
 │   CastError           → 400  "Invalid ID"                   │
 │   LIMIT_FILE_SIZE     → 400  "File exceeds 5MB"             │
 │   ApiError            → statusCode from constructor         │
 │   default             → 500  Internal Server Error          │
 │                                                              │
 │   statusCode >= 500   → Winston logs full stack trace       │
 └──────────────────────────────────────────────────────────────┘
```

---

## Image Upload Flow

```
  Client (React Native)
       │
       │  FormData
       │  images[0] = { uri, name, type: 'image/jpeg' }
       │  images[1] = { ... }
       │
       ▼
  POST /api/sales   (Content-Type: multipart/form-data)
       │
       ▼
  multer.diskStorage()
       │
       ├── fileFilter() ─── file.mimetype starts with 'image/'?
       │                        ✗ ──► Error "Only image files allowed"
       │                        ✓ ──► continue
       │
       ├── limits: { fileSize: 5MB }
       │              over limit ──► LIMIT_FILE_SIZE error → 400
       │
       ├── destination ──► /uploads/
       │
       └── filename ──► sale-{timestamp}-{random}.{ext}
                               │
                               ▼
                    req.files = [{ filename, ... }]
                               │
                               ▼
              Controller maps to:
              images = req.files.map(f => `/uploads/${f.filename}`)
                               │
                               ▼
              Saved to Sale.images[]
                               │
                               ▼
              Served via:  GET /uploads/sale-xxx.jpg
              (express.static)
```

---

## Geospatial Query Flow

```
  GET /api/sales/nearby?lat=30.26&lng=-97.74&maxDistance=50000
            │
            ▼
  saleController.getNearbySales()
            │
            ├── Validate lat & lng present (400 if missing)
            │
            ▼
  Sale.find({
    isActive: true,
    endTime: { $gte: now },
    location: {
      $nearSphere: {
        $geometry: {
          type: 'Point',
          coordinates: [lng, lat]   ← GeoJSON is [lng, lat] order
        },
        $maxDistance: 50000         ← meters (≈ 31 miles)
      }
    }
  })
  .limit(20)
  .populate('seller', ...)
            │
            ▼
  Results sorted by distance (closest first) by MongoDB
            │
            ▼
  200 { sales: [ ... ] }

  ──────────────────────────────────────────────────────
  Index required on Sale model:
    saleSchema.index({ location: '2dsphere' })
  ──────────────────────────────────────────────────────
```

---

## Error Handling Graph

```
  Controller throws / rejects
           │
           ▼
       next(err)
           │
           ▼
  ┌─────────────────────────────────────────┐
  │         errorHandler(err, req, res)     │
  │                                         │
  │  err.name === 'ValidationError'         │
  │    └─► 400  Join all field messages     │
  │                                         │
  │  err.code === 11000                     │
  │    └─► 400  "Email already exists"      │
  │                                         │
  │  err.name === 'JsonWebTokenError'       │
  │    └─► 401  "Invalid token"             │
  │                                         │
  │  err.name === 'TokenExpiredError'       │
  │    └─► 401  "Token expired"             │
  │                                         │
  │  err.name === 'CastError'               │
  │    └─► 400  "Invalid <path>: <value>"   │
  │                                         │
  │  err.code === 'LIMIT_FILE_SIZE'         │
  │    └─► 400  "File size exceeds 5MB"     │
  │                                         │
  │  err.isOperational (ApiError)           │
  │    └─► err.statusCode + err.message     │
  │                                         │
  │  fallthrough                            │
  │    └─► 500  "Internal Server Error"     │
  │           + Winston logger.error()      │
  │                                         │
  │  NODE_ENV=development                   │
  │    └─► also include err.stack in body   │
  └─────────────────────────────────────────┘
           │
           ▼
  JSON Response
  { success: false, message: "..." }
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `5000` | HTTP server port |
| `NODE_ENV` | No | `development` | `development` / `production` |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string |
| `JWT_ACCESS_SECRET` | **Yes** | — | ≥ 32 char random string |
| `JWT_REFRESH_SECRET` | **Yes** | — | ≥ 32 char random string |
| `JWT_ACCESS_EXPIRES` | No | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES` | No | `7d` | Refresh token TTL |
| `SMTP_HOST` | No | — | SMTP server host |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username / email |
| `SMTP_PASS` | No | — | SMTP password / app password |
| `FROM_EMAIL` | No | `noreply@garagesale.com` | Sender email |
| `FROM_NAME` | No | `Garage Sale` | Sender display name |
| `CLIENT_URL` | No | `*` | Allowed CORS origin |
| `MAX_FILE_SIZE` | No | `5242880` | Max upload bytes (5 MB) |

---

## Quick Start

```bash
# 1. Install dependencies
cd garage-backend
npm install

# 2. Copy and fill environment variables
cp .env.example .env
# → Edit MONGODB_URI, JWT secrets, SMTP credentials

# 3. Start development server (nodemon)
npm run dev

# 4. Start production server
npm start

# 5. Health check
curl http://localhost:5000/health
# → { "success": true, "message": "Server is healthy", "timestamp": "..." }
```

### Standard Response Format

```json
// Success
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { ... },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}

// Error
{
  "success": false,
  "message": "Invalid email or password"
}

// Validation Error
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Valid email is required" },
    { "field": "password", "message": "Password must be at least 6 characters" }
  ]
}
```

---

*Generated for Garage Sale Finder — Node.js / Express / MongoDB / JWT Backend*
