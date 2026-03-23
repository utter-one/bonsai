# Use Node.js LTS version with security updates
FROM node:20-slim

# Install curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
# RUN npm ci --only=production
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./
COPY drizzle.config.ts ./
COPY drizzle/ ./drizzle/
COPY schemas/ ./schemas/

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"]
