# 招商产园 GEO 智控台——Docker 镜像
# 零 Python 包依赖（标准库 only）；前端也是单文件 HTML，零 npm 依赖
FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/JackieAi2008/geo-control-console"
LABEL org.opencontainers.image.description="招商产园 GEO 智控台——AI 搜索可见性诊断与监测系统"

WORKDIR /app

# 仅 copy 必要产物（.dockerignore 会屏蔽其余）
COPY system/ /app/system/

# 数据与备份挂到 /var/lib/geo-control/（容器外持久化）
ENV GEO_DATA_DIR=/var/lib/geo-control
ENV GEO_PORT=8340
ENV PYTHONUNBUFFERED=1

EXPOSE 8340

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:'+__import__('os').environ.get('GEO_PORT','8340')+'/api/ping', timeout=3).read()" || exit 1

CMD ["sh", "-c", "cd /app/system && exec python3 server.py --port ${GEO_PORT} --db ${GEO_DATA_DIR}/geodesk.db"]