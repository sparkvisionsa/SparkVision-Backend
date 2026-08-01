# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PYTHONDONTWRITEBYTECODE=1
# LibreOffice يحوّل Word→PDF بجودة صور عالية؛ python-docx لدمج القالب
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-lxml \
    python3-pil \
    libreoffice-writer-nogui \
    fonts-dejavu-core \
    fonts-noto-core \
  && python3 -m pip install --no-cache-dir --break-system-packages "python-docx==1.2.0" \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/docx-worker/merge_docx.py ./docx-worker/merge_docx.py
COPY --from=builder /app/docx-worker/requirements.txt ./docx-worker/requirements.txt
COPY package*.json ./
EXPOSE 5000
CMD ["node", "dist/main.js"]
