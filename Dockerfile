# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PYTHONDONTWRITEBYTECODE=1
RUN apk add --no-cache python3 py3-pip py3-lxml py3-pillow \
  && python3 -m pip install --no-cache-dir --break-system-packages "python-docx==1.2.0"
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/docx-worker/merge_docx.py ./docx-worker/merge_docx.py
COPY --from=builder /app/docx-worker/requirements.txt ./docx-worker/requirements.txt
COPY package*.json ./
EXPOSE 5000
CMD ["node", "dist/main.js"]
