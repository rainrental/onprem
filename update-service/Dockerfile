FROM alpine:latest

# Install required packages
RUN apk add --no-cache \
    curl \
    jq \
    git \
    docker-cli \
    docker-compose \
    bash \
    cronie

# Create update service user
RUN addgroup -g 1002 -S updatesvc
RUN adduser -S updatesvc -u 1002

# Create directories
RUN mkdir -p /app/scripts /app/config /app/logs
RUN mkdir -p /home/updatesvc/.cache
RUN mkdir -p /var/run
RUN chown -R updatesvc:updatesvc /app
RUN chown -R updatesvc:updatesvc /home/updatesvc
RUN chown updatesvc:updatesvc /var/run

# Copy update scripts
COPY scripts/ /app/scripts/
RUN chmod +x /app/scripts/*.sh

# Copy startup script
COPY scripts/start.sh /app/start.sh
RUN chown updatesvc:updatesvc /app/start.sh && chmod +x /app/start.sh

# Switch to update service user
USER updatesvc

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD /app/scripts/healthcheck.sh

# Start with dynamic configuration
CMD ["/app/start.sh"] 