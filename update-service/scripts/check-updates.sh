#!/bin/bash

# Automated update checker and performer
# Runs every 15 minutes via cron
# Checks for updates and performs them automatically with safety checks

set -e

# Configuration
GATEWAY_URL="http://firebase-gateway:3000"
CONFIG_FILE="/app/config/update-config.json"
STATUS_FILE="/app/config/update-status.json"
LOG_FILE="/app/logs/updates.log"
GITHUB_REPO="${GITHUB_REPO:-your-org/onprem-repo}"

# Log function
log_message() {
    if [ -n "$LOG_FILE" ] && [ -w "$(dirname "$LOG_FILE")" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE" >&2
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
    fi
}

# Extract owner/repo from full URL if needed
if [[ "$GITHUB_REPO" == https://github.com/* ]]; then
    # Remove https://github.com/ and .git suffix
    GITHUB_REPO=$(echo "$GITHUB_REPO" | sed 's|https://github.com/||' | sed 's|\.git$||')
    log_message "Extracted repository from URL: $GITHUB_REPO"
fi

GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}"

# Log configuration at startup
log_message "Update service configuration:"
log_message "  Gateway URL: $GATEWAY_URL"
log_message "  GitHub Repository: $GITHUB_REPO"
log_message "  GitHub API: $GITHUB_API"

# Function to get current version from GitHub
get_latest_version() {
    log_message "Getting latest version from GitHub..."
    log_message "GitHub repository: $GITHUB_REPO"
    log_message "GitHub API URL: $GITHUB_API/releases/latest"
    local response=""
    
    # Try to get response from GitHub API
    if ! response=$(curl -s "$GITHUB_API/releases/latest" 2>/dev/null); then
        log_message "ERROR: Failed to connect to GitHub API"
        log_message "ERROR: Repository: $GITHUB_REPO"
        log_message "ERROR: API URL: $GITHUB_API/releases/latest"
        log_message "ERROR: This could be due to network issues, invalid repository, or GitHub API being unavailable"
        return 1
    fi
    
    log_message "GitHub response: $response"
    
    # Check if response is valid JSON and has tag_name
    log_message "Checking if response is valid JSON..."
    if echo "$response" | jq . >/dev/null 2>&1; then
        log_message "Response is valid JSON"
        # Check if it's an error response
        log_message "Checking for error message..."
        local error_message=$(echo "$response" | jq -r '.message // ""')
        if [ -n "$error_message" ]; then
            log_message "ERROR: GitHub API error: $error_message"
            log_message "ERROR: Repository: $GITHUB_REPO"
            log_message "ERROR: API URL: $GITHUB_API/releases/latest"
            return 1
        fi
        
        log_message "Extracting tag_name..."
        local version=$(echo "$response" | jq -r '.tag_name // ""')
        if [ -z "$version" ]; then
            log_message "ERROR: No tag_name found in GitHub response"
            log_message "ERROR: Repository: $GITHUB_REPO"
            log_message "ERROR: Response: $response"
            return 1
        fi
        log_message "Latest version: $version"
        echo "$version"
    else
        log_message "ERROR: Invalid GitHub response (not valid JSON)"
        log_message "ERROR: Repository: $GITHUB_REPO"
        log_message "ERROR: Response: $response"
        return 1
    fi
}

# Function to get specific version info
get_version_info() {
    local version=$1
    log_message "Getting specific version info for: $version"
    log_message "GitHub repository: $GITHUB_REPO"
    log_message "GitHub API URL: $GITHUB_API/releases/tags/$version"
    
    local response=$(curl -s "$GITHUB_API/releases/tags/$version")
    
    # Check if response is valid JSON and has tag_name
    if echo "$response" | jq . >/dev/null 2>&1; then
        # Check if it's an error response
        local error_message=$(echo "$response" | jq -r '.message // ""')
        if [ -n "$error_message" ]; then
            log_message "ERROR: GitHub API error for version $version: $error_message"
            log_message "ERROR: Repository: $GITHUB_REPO"
            log_message "ERROR: API URL: $GITHUB_API/releases/tags/$version"
            return 1
        fi
        
        local tag_name=$(echo "$response" | jq -r '.tag_name // ""')
        if [ -z "$tag_name" ]; then
            log_message "ERROR: No tag_name found in GitHub response for version $version"
            log_message "ERROR: Repository: $GITHUB_REPO"
            log_message "ERROR: Response: $response"
            return 1
        fi
        echo "$tag_name"
    else
        log_message "ERROR: Invalid GitHub response for version $version (not valid JSON)"
        log_message "ERROR: Repository: $GITHUB_REPO"
        log_message "ERROR: Response: $response"
        return 1
    fi
}

# Function to check if update is available
check_for_updates() {
    local current_version=$1
    local update_strategy=$2
    
    log_message "Checking for updates: current=$current_version, strategy=$update_strategy"
    
    if [ "$update_strategy" = "latest" ]; then
        log_message "Using latest strategy..."
        local latest_version=""
        if ! latest_version=$(get_latest_version); then
            log_message "ERROR: Failed to get latest version from GitHub"
            log_message "ERROR: Cannot determine if update is available"
            echo "{\"updateAvailable\": false, \"currentVersion\": \"$current_version\", \"error\": \"Failed to get latest version from GitHub\"}"
            return 1
        fi
        log_message "Latest version available: $latest_version"
        
        if [ "$latest_version" != "$current_version" ]; then
            log_message "Update available: $current_version -> $latest_version"
            echo "{\"updateAvailable\": true, \"targetVersion\": \"$latest_version\", \"currentVersion\": \"$current_version\"}"
            return 0
        else
            log_message "No update needed, versions match"
        fi
    else
        log_message "Using specific version strategy: $update_strategy"
        # Check if specific version exists and is newer
        local target_version=""
        if ! target_version=$(get_version_info "$update_strategy"); then
            log_message "ERROR: Failed to get version info for $update_strategy from GitHub"
            log_message "ERROR: Cannot determine if update is available"
            echo "{\"updateAvailable\": false, \"currentVersion\": \"$current_version\", \"error\": \"Failed to get version info for $update_strategy from GitHub\"}"
            return 1
        fi
        
        if [ "$target_version" != "$current_version" ]; then
            log_message "Update available: $current_version -> $target_version"
            echo "{\"updateAvailable\": true, \"targetVersion\": \"$target_version\", \"currentVersion\": \"$current_version\"}"
            return 0
        else
            log_message "No update needed, versions match"
        fi
    fi
    
    log_message "No update available"
    echo "{\"updateAvailable\": false, \"currentVersion\": \"$current_version\"}"
    return 0
}

# Function to perform automated update
perform_automated_update() {
    local target_version=$1
    local current_version=$2
    
    log_message "Starting automated update: $current_version -> $target_version"
    
    # Safety check: Don't update if services are unhealthy
    if ! docker-compose ps | grep -q "Up"; then
        log_message "ERROR: Services are not healthy, skipping update"
        return 1
    fi
    
    # Safety check: Don't update if last update was too recent (within 1 hour)
    if [ -f "/app/config/last-update.txt" ]; then
        local last_update=$(cat "/app/config/last-update.txt")
        local now=$(date +%s)
        local time_diff=$((now - last_update))
        
        if [ $time_diff -lt 3600 ]; then
            log_message "WARNING: Last update was too recent, skipping"
            return 0
        fi
    fi
    
    # Download the release
    local release_response=$(curl -s "$GITHUB_API/releases/tags/$target_version")
    local download_url=""
    if echo "$release_response" | jq . >/dev/null 2>&1; then
        download_url=$(echo "$release_response" | jq -r '.tarball_url // ""')
    fi
    
    if [ -z "$download_url" ]; then
        log_message "ERROR: Could not get download URL for version $target_version"
        return 1
    fi
    local temp_dir="/tmp/update_$$"
    
    mkdir -p "$temp_dir"
    cd "$temp_dir"
    
    log_message "Downloading version $target_version"
    curl -L "$download_url" | tar -xz --strip-components=1
    
    # Stop services gracefully
    log_message "Stopping Docker Compose services"
    cd /app/workspace
    docker-compose down
    
    # Backup current config
    local backup_file=".env.backup.$(date +%Y%m%d_%H:%M:%S)"
    cp .env "$backup_file"
    log_message "Backup created: $backup_file"
    
    # Copy new files (preserve .env)
    cp -r "$temp_dir"/* .
    cp "$backup_file" .
    
    # Update version file
    echo "$target_version" > VERSION
    
    # Restart services
    log_message "Starting updated services"
    docker-compose up -d
    
    # Wait for services to be healthy
    log_message "Waiting for services to be healthy..."
    sleep 30
    
    # Verify services are running
    if docker-compose ps | grep -q "Up"; then
        log_message "Update completed successfully"
        echo "$(date +%s)" > "/app/config/last-update.txt"
        return 0
    else
        log_message "ERROR: Services failed to start after update, rolling back"
        # Rollback logic could be added here
        return 1
    fi
}

# Get update configuration from Firebase Gateway
log_message "Checking for update configuration"
# Use environment variables for location and company ID
LOCATION_NAME="${LOCATIONNAME}"
COMPANY_ID="${COMPANY_ID}"

# Validate required environment variables
if [ -z "$LOCATION_NAME" ]; then
    log_message "ERROR: LOCATIONNAME environment variable is required"
    exit 1
fi

if [ -z "$COMPANY_ID" ]; then
    log_message "ERROR: COMPANY_ID environment variable is required"
    exit 1
fi

log_message "Using location: $LOCATION_NAME, company: $COMPANY_ID"
config_response=$(curl -s "$GATEWAY_URL/api/config/location/${LOCATION_NAME}?companyId=${COMPANY_ID}")

if [ $? -ne 0 ]; then
    log_message "Failed to get update configuration from gateway"
    exit 1
fi

# Debug: Log the actual response
log_message "Gateway response: $config_response"

# Check if response is valid JSON
if ! echo "$config_response" | jq . >/dev/null 2>&1; then
    log_message "ERROR: Invalid JSON response from gateway"
    log_message "Response: $config_response"
    # Don't exit, just return gracefully
    return 0
fi

# Parse configuration with error handling
log_message "Parsing update_strategy..."
update_strategy=$(echo "$config_response" | jq -r '.config.updateStrategy // "latest"')
log_message "Parsing auto_update..."
auto_update=$(echo "$config_response" | jq -r '.config.autoUpdate // false')
log_message "Parsing current_version..."
current_version=$(echo "$config_response" | jq -r '.config.currentVersion // "v1.02.03"')

if [ "$auto_update" != "true" ]; then
    log_message "Auto-update is disabled"
    exit 0
fi

log_message "Current version: $current_version, Strategy: $update_strategy"

# Check for updates
log_message "Calling check_for_updates..."
if ! update_info=$(check_for_updates "$current_version" "$update_strategy"); then
    log_message "ERROR: check_for_updates failed"
    log_message "ERROR: Cannot proceed with update check"
    exit 1
fi
log_message "check_for_updates returned: $update_info"
update_available=$(echo "$update_info" | jq -r '.updateAvailable // false')

if [ "$update_available" = "true" ]; then
    target_version=$(echo "$update_info" | jq -r '.targetVersion // ""')
    log_message "Update available: $current_version -> $target_version"
    
    # Check if auto-update is enabled
    auto_update_enabled=$(echo "$config_response" | jq -r '.config.autoUpdate // false')
    
    if [ "$auto_update_enabled" = "true" ]; then
        log_message "Auto-update enabled, performing update"
        perform_automated_update "$target_version" "$current_version"
        
        if [ $? -eq 0 ]; then
            log_message "Automated update completed successfully"
            echo "{\"updateAvailable\": false, \"currentVersion\": \"$target_version\", \"lastUpdated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$STATUS_FILE"
        else
            log_message "Automated update failed"
            echo "$update_info" > "$STATUS_FILE"
        fi
    else
        log_message "Auto-update disabled, storing update info for manual review"
        echo "$update_info" > "$STATUS_FILE"
    fi
else
    log_message "No update needed"
    # Clear any pending update status
    echo "{\"updateAvailable\": false, \"currentVersion\": \"$current_version\"}" > "$STATUS_FILE"
fi

# Update last checked timestamp
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "/app/config/last-checked.txt" 