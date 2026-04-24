# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install all deps (including devDeps needed for tsc + build script)
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json tsconfig.prod.json build.ts ./
COPY src ./src
RUN npm run build

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output (includes public_key.pem copied by build.ts)
COPY --from=builder /app/dist ./dist

EXPOSE 8891

CMD ["npm", "start"]
