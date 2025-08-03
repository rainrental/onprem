FROM node:18-alpine

# Install socat for tunnel functionality
RUN apk add --no-cache socat

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY src/ ./src/

# Copy configuration files
COPY config/ ./config/

# Create a non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port (if needed)
# EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"] 