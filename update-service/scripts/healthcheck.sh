#!/bin/bash

# Health check for update service
# Checks if cron is running and logs are being written

# Check if cron daemon is running
if ! pgrep crond > /dev/null; then
    echo "CRITICAL: Cron daemon not running"
    exit 1
fi

# Check if update script exists and is executable
if [ ! -x "/app/scripts/check-updates.sh" ]; then
    echo "CRITICAL: Update script not found or not executable"
    exit 1
fi

# Check if log file is being written to (optional)
if [ -f "/app/logs/updates.log" ]; then
    # Check if log was updated in last 30 minutes
    last_log=$(stat -c %Y /app/logs/updates.log 2>/dev/null || echo 0)
    current_time=$(date +%s)
    time_diff=$((current_time - last_log))
    
    if [ $time_diff -gt 1800 ]; then
        echo "WARNING: Log file not updated in last 30 minutes"
        exit 1
    fi
fi

echo "OK: Update service is healthy"
exit 0 