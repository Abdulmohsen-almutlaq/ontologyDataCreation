# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.tests.json ./
COPY src ./src
RUN npm run build

# ---------- dev ----------
FROM node:22-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.tests.json ./
COPY src ./src
COPY tests ./tests
# prompts are runtime data, never compiled into dist/
COPY prompts ./prompts
# Prompts are bind-mounted in compose, so edits take effect without a rebuild.
CMD ["sh", "-c", "npm run build && node dist/index.js"]

# ---------- prod ----------
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV PROMPTS_DIR=/app/prompts
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# CRITICAL: prompts live outside dist/ and must be shipped explicitly.
COPY prompts ./prompts
COPY tests/fixtures ./tests/fixtures
EXPOSE 3000
CMD ["node", "dist/index.js"]
