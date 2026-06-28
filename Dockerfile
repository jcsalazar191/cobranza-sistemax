# ---------- build del frontend ----------
FROM node:20-alpine AS fe
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build   # usa .env.production (VITE_API_URL=/api)

# ---------- runtime backend (sirve API + frontend) ----------
FROM node:20-alpine
RUN apk add --no-cache tzdata
ENV NODE_ENV=production TZ=America/Lima
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
# El backend sirve ../../frontend/dist
COPY --from=fe /fe/dist /app/frontend/dist
EXPOSE 3100
CMD ["node", "src/index.js"]
