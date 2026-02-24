# Build frontend
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Build backend and serve
FROM python:3.11-slim AS runtime

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy backend files
COPY vodila/pyproject.toml vodila/uv.lock ./
COPY vodila/ ./vodila/

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist/ ./vodila/static/

# Copy source data for parsing
COPY source_data/ ./source_data/

# Create data directory for persistent database
RUN mkdir -p /app/data

# Expose port
EXPOSE 8000

# Environment variables
ENV PYTHONPATH=/app
ENV DATABASE_PATH=/app/data/rules.db
ENV VITE_API_URL=/api

# Run the application
CMD ["uv", "run", "uvicorn", "vodila.main:app", "--host", "0.0.0.0", "--port", "8000"]
