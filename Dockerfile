# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage - Use official Playwright image
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

# Create non-root user (pwuser already exists in Playwright image, but we'll use our own)
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -s /bin/bash nestjs

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

# Expose port
EXPOSE 3000

# Switch to non-root user
USER nestjs

# Start application (no need for Xvfb - Playwright handles headless natively)
CMD ["dumb-init", "node", "dist/main.js"]