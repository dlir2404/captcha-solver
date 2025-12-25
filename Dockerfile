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

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install dependencies for Chrome/Chromium AND Xvfb
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-cjk \
    font-opensans \
    xvfb \
    xvfb-run \
    dbus \
    udev \
    ttf-liberation

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

# Install dumb-init to handle signals properly
RUN apk add --no-cache dumb-init

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Set environment variable for Puppeteer to use system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV DISPLAY=:99

# Copy built application from builder
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

# Expose port (default NestJS port)
EXPOSE 3000

# Create startup script
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &' >> /app/start.sh && \
    echo 'sleep 2' >> /app/start.sh && \
    echo 'exec node dist/main.js' >> /app/start.sh && \
    chmod +x /app/start.sh && \
    chown nestjs:nodejs /app/start.sh

# Switch to non-root user
USER nestjs

# Start application with Xvfb
CMD ["/app/start.sh"]