# Build frontend
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Build backend
FROM node:22-slim AS backend-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY patches/ ./patches/
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production
FROM node:22-slim
WORKDIR /app

# Install Foundry dependencies
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*

# Install Foundry
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="/root/.foundry/bin:${PATH}"
RUN foundryup

COPY package.json package-lock.json* ./
COPY patches/ ./patches/
RUN npm install --omit=dev --ignore-scripts

COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV PORT=7860
EXPOSE 7860

# Ensure scripts are executable
COPY scripts/ ./scripts/
RUN chmod +x scripts/*.sh

CMD ["node", "dist/server.js"]
