#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  云效 Flow 部署脚本 — CI 预构建 + docker-compose
#
#  前置条件：云效主机部署步骤已将制品解压到 DEPLOY_DIR
#  目录中应包含：.output/ Dockerfile docker-compose.yml deploy.sh
#
#  以下变量在云效流水线「变量配置」中设置，运行时自动注入：
#
#  可选（有默认值）：
#    DEPLOY_DIR        — 部署目录，默认 /usr/local/share/applications/db-pilot
#    APP_PORT          — 宿主机映射端口，默认 3000
#
#  业务环境变量（按需填写，敏感项请勾选「加密」）：
#    DEEPSEEK_API_KEY / BAILIAN_API_KEY
#    BAILIAN_API_BASE_URL
#    LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL
#    ENCRYPTION_KEY
#    DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_DATABASE
# ============================================================

DEPLOY_DIR="${DEPLOY_DIR:-/opt/db-pilot}"
APP_PORT="${APP_PORT:-3000}"
APP_IMAGE="${APP_IMAGE:-db-pilot:latest}"
umask 077

echo "========================================"
echo " 部署 db-pilot"
echo " 目录: ${DEPLOY_DIR}"
echo " 端口: ${APP_PORT}"
echo "========================================"

# ---------- 1. 检查制品完整性 ----------
if [ ! -d "${DEPLOY_DIR}/.output" ]; then
    echo ">>> 错误：${DEPLOY_DIR}/.output 不存在，请检查制品是否正确解压"
    exit 1
fi

# ---------- 2. 写入 .env 文件 ----------
PREVIOUS_ENV="$(mktemp "${DEPLOY_DIR}/.env.rollback.XXXXXX")"
HAD_ENV=false
if [ -f "${DEPLOY_DIR}/.env" ]; then
    cp "${DEPLOY_DIR}/.env" "${PREVIOUS_ENV}"
    HAD_ENV=true
fi
trap 'rm -f "${PREVIOUS_ENV}"' EXIT

cat > "${DEPLOY_DIR}/.env" <<EOF
APP_PORT=${APP_PORT}
APP_BIND_HOST=${APP_BIND_HOST:-127.0.0.1}
APP_IMAGE=${APP_IMAGE}

DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
DEEPSEEK_API_BASE_URL=${DEEPSEEK_API_BASE_URL:-}

BAILIAN_API_KEY=${BAILIAN_API_KEY:-}
BAILIAN_API_BASE_URL=${BAILIAN_API_BASE_URL:-}

LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY:-}
LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY:-}
LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL:-}
LANGFUSE_CAPTURE_CONTENT=${LANGFUSE_CAPTURE_CONTENT:-false}
SQL_WRITE_ENABLED=${SQL_WRITE_ENABLED:-false}
SQL_WRITE_ALLOWLIST=${SQL_WRITE_ALLOWLIST:-}
MEMO_CHAT_API_BASE=${MEMO_CHAT_API_BASE:-http://127.0.0.1:7860}

ENCRYPTION_KEY=${ENCRYPTION_KEY:-}

DB_HOST=${DB_HOST:-}
DB_PORT=${DB_PORT:-3306}
DB_USER=${DB_USER:-}
DB_PASSWORD=${DB_PASSWORD:-}
DB_DATABASE=${DB_DATABASE:-}
EOF

chmod 600 "${DEPLOY_DIR}/.env"

# ---------- 3. 构建镜像 & 启动 ----------
cd "${DEPLOY_DIR}"

PREVIOUS_IMAGE="$(docker inspect --format='{{.Image}}' db-pilot 2>/dev/null || true)"
restore_env() {
    if [ "${HAD_ENV}" = true ]; then
        cp "${PREVIOUS_ENV}" "${DEPLOY_DIR}/.env"
    else
        rm -f "${DEPLOY_DIR}/.env"
    fi
}
rollback() {
    restore_env
    if [ -n "${PREVIOUS_IMAGE}" ]; then
        echo ">>> 恢复上一版本镜像与配置 ..."
        docker tag "${PREVIOUS_IMAGE}" "${APP_IMAGE}"
        docker compose up -d --no-build --force-recreate
    fi
}

echo ">>> 构建镜像（仅打包 .output 到运行镜像）..."
if ! docker compose build; then
    restore_env
    echo ">>> 构建失败，原容器保持运行"
    exit 1
fi

echo ">>> 启动容器 ..."
if ! docker compose up -d --no-build; then
    rollback
    exit 1
fi

# ---------- 4. 健康检查 ----------
echo ">>> 等待健康检查 ..."
MAX_RETRIES=30
RETRY_INTERVAL=2

for i in $(seq 1 ${MAX_RETRIES}); do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' db-pilot 2>/dev/null || echo "starting")
    if [ "${STATUS}" = "healthy" ]; then
        echo ">>> 容器健康，部署成功！"
        break
    fi
    if [ "${i}" -eq "${MAX_RETRIES}" ]; then
        echo ">>> 健康检查超时，请手动检查容器状态"
        docker compose logs --tail=50
        rollback
        exit 1
    fi
    echo "   等待中... (${i}/${MAX_RETRIES}) 状态: ${STATUS}"
    sleep ${RETRY_INTERVAL}
done

# 保留上一版本镜像用于回滚，按运维保留策略另行清理。

echo "========================================"
echo " 部署完成"
echo " 本机入口: http://127.0.0.1:${APP_PORT}/workbench/dbpilot"
echo " 团队访问请通过配置了身份验证的 HTTPS 反向代理"
echo "========================================"
