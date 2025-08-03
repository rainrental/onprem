#!/bin/bash

# Startup script for update service
# Handles dynamic cron configuration and service startup

set -e

# Configuration
CRON_INTERVAL=${UPDATE_CHECK_INTERVAL:-15}
LOG_FILE="/app/logs/updates.log"
CRON_FILE="/tmp/crontab"

# Create log file if it doesn't exist
touch "$LOG_FILE"

# Create cache directory if it doesn't exist
mkdir -p /home/updatesvc/.cache

# Create dynamic crontab based on environment variable
echo "*/${CRON_INTERVAL} * * * * /app/scripts/check-updates.sh >> ${LOG_FILE} 2>&1" > "$CRON_FILE"

# Install the crontab
crontab "$CRON_FILE" || echo "Failed to install crontab, continuing anyway"

# Log startup
echo "$(date '+%Y-%m-%d %H:%M:%S') - Update service started with ${CRON_INTERVAL} minute interval" >> "$LOG_FILE"

# For now, just run the update check once and then sleep
# This is a temporary solution until we fix the cron issues
echo "$(date '+%Y-%m-%d %H:%M:%S') - Running initial update check..." >> "$LOG_FILE"
/app/scripts/check-updates.sh

# Keep container running with periodic checks
while true; do
    sleep $((CRON_INTERVAL * 60))
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Running scheduled update check..." >> "$LOG_FILE"
    /app/scripts/check-updates.sh
done 