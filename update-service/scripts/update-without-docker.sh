#!/bin/bash

# Alternative update mechanism that doesn't require Docker socket access
# This script can be called externally to restart services

set -e

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "/app/logs/updates.log" >&2
}

# Function to restart services via external mechanism
restart_services() {
    local target_version=$1
    
    log "Restarting services for version $target_version"
    
    # Option 1: Use systemd (if available)
    if command -v systemctl >/dev/null 2>&1; then
        log "Using systemd to restart services"
        systemctl restart rfid-onprem
        return $?
    fi
    
    # Option 2: Use external restart script
    if [ -f "/app/scripts/restart-services.sh" ]; then
        log "Using external restart script"
        /app/scripts/restart-services.sh
        return $?
    fi
    
    # Option 3: Signal external process
    log "Sending restart signal to external process"
    echo "RESTART_REQUIRED:$target_version" > /app/config/restart-flag.txt
    
    return 0
}

# Main update function
perform_update() {
    local target_version=$1
    local current_version=$2
    
    log "Starting update: $current_version -> $target_version"
    
    # Download and extract new version
    # ... (same as original script)
    
    # Use alternative restart mechanism
    restart_services "$target_version"
    
    if [ $? -eq 0 ]; then
        log "Update completed successfully"
        return 0
    else
        log "Update failed"
        return 1
    fi
}

# This script can be called by the main update script
if [ "$1" = "restart" ]; then
    restart_services "$2"
    exit $?
fi 