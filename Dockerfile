# ---- Build Stage ----
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Production Stage ----
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/.output .output

ENV PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
