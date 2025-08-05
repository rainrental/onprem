# Deduplication Logic and Logging

## Overview

The RFID processor implements a clean, efficient deduplication system to prevent duplicate tag reads from being reported while ensuring no tag events are lost. The system uses a time-based approach with configurable intervals and minimal code complexity.

## Deduplication Flow

### 1. Configuration State
The system maintains a state with three key flags:
- `deduplicate`: Whether deduplication is enabled
- `deduplicateInterval`: Time interval for deduplication (default: 2 minutes)
- `reporting`: Whether tag events should be reported to the backend

### 2. Deduplication Key Generation
Each tag event is assigned a deduplication key based on:
- Hostname group (from hostname groups configuration)
- Tag ID (tidHex)

Format: `{groupName}:{tidHex}`

### 3. Decision Logic

#### Step 1: Deduplication Check
```javascript
const shouldReport = !state.deduplicate || 
  this.deduplicator.shouldReport(timestamp, key, tagDocument, uniqueCount);
```

- If `deduplicate=false`: Always report (no deduplication)
- If `deduplicate=true`: Check with deduplicator

#### Step 2: Final Decision
```javascript
if (shouldReport && state.reporting) {
  // Queue for reporting
} else if (shouldReport && !state.reporting) {
  // Log as not-reported
} else if (!shouldReport) {
  // Tag was deduplicated
}
```

## Deduplicator Behavior

### First Detection
- Returns `true` (should report)
- Caches the event with a timer
- Logs as "processing"

### Subsequent Detections (within interval)
- Returns `false` (should not report)
- Updates cached event with latest data
- Logs as "cached"

### Interval Expiration
- Timer fires and reports cached event
- Logs as "delayed-report"
- Clears cache entry

## Logging Patterns

### TPD (Tag Processing Decision) Log
Format: `TPD: {emoji} {outcome} [Key: {key}]`

- **📤 Delivered**: Tag was immediately queued for reporting
- **⏳ Cached**: Tag was deduplicated and will be reported after interval
- **🚫 Not Reported**: Tag should be reported but reporting is disabled
- **❌ Error**: Unexpected state combination
- **Key**: Deduplication key used

### Tag Event Logging
Uses structured logging with color coding:

- **Blue**: `processing` - First detection of a tag
- **Green**: `delivered` - Successfully queued for immediate reporting
- **Yellow**: `cached` - Tag deduplicated, will be reported later
- **Magenta**: `delayed-report` - Cached event being reported after interval
- **Gray**: `not-reported` - Should report but reporting disabled

### Log Format
```
Tag {status}: {tagId} | {hostname} | {uniqueCount}
```

## Example Scenarios

### Scenario 1: Deduplication Enabled, Reporting Enabled
1. Tag ABC123 first detected → `processing` (blue) → `delivered` (green)
2. Tag ABC123 detected again within interval → `cached` (yellow)
3. After interval expires → `delayed-report` (magenta)

### Scenario 2: Deduplication Disabled, Reporting Enabled
1. Tag ABC123 detected → `processing` (blue) → `delivered` (green)
2. Tag ABC123 detected again → `processing` (blue) → `delivered` (green)

### Scenario 3: Deduplication Enabled, Reporting Disabled
1. Tag ABC123 first detected → `processing` (blue) → `not-reported` (gray)
2. Tag ABC123 detected again → `cached` (yellow)

## Configuration

The deduplication behavior is controlled by the Firebase Gateway configuration:
- `deduplicate` / `deduplicateMobile`: Enable/disable deduplication
- `deduplicateInterval` / `deduplicateMobileInterval`: Time interval in minutes (default: 2)
- `reporting` / `reportingMobile`: Enable/disable reporting

**Important**: The deduplicator interval is dynamically updated when configuration changes. The system will:
1. Load the initial interval from configuration on startup
2. Update the interval whenever configuration is refreshed from the gateway
3. Recreate existing timers with the new interval when it changes

## Testing

The deduplication logic is thoroughly tested in `deduplicator.test.js` with scenarios covering:
- Basic deduplication behavior
- Multiple detections within interval
- Hostname grouping
- Interval expiration
- Multiple intervals
- Cleanup behavior 