# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install all deps (including devDeps needed for tsc + build script)
COPY govauctionplatform/package*.json ./
RUN npm ci

# Copy source and compile
COPY govauctionplatform/tsconfig.json govauctionplatform/tsconfig.prod.json govauctionplatform/build.ts ./
COPY govauctionplatform/src ./src
RUN npm run build

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install production deps only
COPY govauctionplatform/package*.json ./
RUN npm ci --omit=dev

# Copy compiled output (includes any static assets copied by build.ts)
COPY --from=builder /app/dist ./dist

EXPOSE 8891

CMD ["npm", "start"]
