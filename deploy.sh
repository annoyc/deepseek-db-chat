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
cat > "${DEPLOY_DIR}/.env" <<EOF
APP_PORT=${APP_PORT}

DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}

BAILIAN_API_KEY=${BAILIAN_API_KEY:-}
BAILIAN_API_BASE_URL=${BAILIAN_API_BASE_URL:-}

LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY:-}
LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY:-}
LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL:-}

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

echo ">>> 停止旧容器 ..."
docker compose down --remove-orphans 2>/dev/null || true

echo ">>> 构建镜像（仅打包 .output 到运行镜像）..."
docker compose build

echo ">>> 启动容器 ..."
docker compose up -d

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
        exit 1
    fi
    echo "   等待中... (${i}/${MAX_RETRIES}) 状态: ${STATUS}"
    sleep ${RETRY_INTERVAL}
done

# ---------- 5. 清理悬挂镜像 ----------
echo ">>> 清理无用镜像 ..."
docker image prune -f 2>/dev/null || true

echo "========================================"
echo " 部署完成"
echo " 访问: http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo "========================================"
