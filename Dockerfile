# ---- Build Stage ----
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# 启用 CI 模式，并允许依赖的构建脚本自动运行，防止 pnpm v10/v11 拦截 native 依赖构建
ENV CI=true
ENV pnpm_config_dangerously_allow_all_builds=true

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
