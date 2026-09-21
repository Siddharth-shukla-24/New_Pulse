# Build context must be the repository root (see render.yaml): docker build -f backend/Dockerfile .
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHON_BIN=/opt/venv/bin/python

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv

WORKDIR /app

COPY scraper/requirements.txt scraper/requirements.txt
RUN /opt/venv/bin/pip install -r scraper/requirements.txt

COPY backend/package.json backend/
RUN cd backend && npm install --omit=dev

COPY db db
COPY scraper scraper
COPY backend backend

WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "src/server.js"]