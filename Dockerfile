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
# LibreOffice remains the Linux renderer for Office files until an external
# Microsoft 365 conversion service is configured. WeasyPrint renders the
# native real-estate PDF worker, and Poppler rasterizes PDF attachments.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    python3 \
    python3-pip \
    python3-venv \
    libreoffice-writer-nogui \
    libreoffice-impress-nogui \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz-subset0 \
    libjpeg62-turbo \
    libopenjp2-7 \
    libffi8 \
    shared-mime-info \
    poppler-utils \
    fontconfig \
    fonts-dejavu-core \
    fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets/fonts ./assets/fonts
COPY --from=builder /app/docx-worker ./docx-worker
COPY --from=builder /app/pdf-worker ./pdf-worker
COPY --from=builder /app/pptx-worker ./pptx-worker
RUN bash docx-worker/setup-venv.sh \
  && bash pdf-worker/setup-venv.sh
COPY package*.json ./
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
