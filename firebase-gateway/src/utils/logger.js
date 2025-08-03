const { config } = require('../config/environment');

class Logger {
  constructor() {
    this.colors = {
      reset: '\x1b[0m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      gray: '\x1b[90m'
    };
  }

  timestamp() {
    return new Date().toISOString();
  }

  colorize(text, color) {
    if (!config.logging.enableColoredOutput) {
      return text;
    }
    return `${this.colors[color] || this.colors.reset}${text}${this.colors.reset}`;
  }

  formatMessage(level, message, data = null) {
    const timestamp = config.logging.enableTimestamp ? `[${this.timestamp()}]` : '';
    const prefix = this.colorize(`[${level.toUpperCase()}]`, this.getLevelColor(level));
    const formattedMessage = `${timestamp} ${prefix} ${message}`;
    
    if (data) {
      return `${formattedMessage} ${JSON.stringify(data)}`;
    }
    return formattedMessage;
  }

  getLevelColor(level) {
    const colorMap = {
      info: 'blue',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      debug: 'gray'
    };
    return colorMap[level] || 'white';
  }

  info(message, data = null) {
    console.log(this.formatMessage('info', message, data));
  }

  success(message, data = null) {
    console.log(this.formatMessage('success', message, data));
  }

  warning(message, data = null) {
    console.log(this.formatMessage('warning', message, data));
  }

  error(message, error = null) {
    const errorData = error ? { message: error.message, stack: error.stack } : null;
    console.error(this.formatMessage('error', message, errorData));
  }

  debug(message, data = null) {
    if (process.env.NODE_ENV === 'development') {
      console.log(this.formatMessage('debug', message, data));
    }
  }

  // Modern structured logging for tag events with color coding
  tag(event, metadata = {}) {
    const { tagId, hostname, uniqueCount, action, cachedCount } = metadata;
    
    let status = action || 'processed';
    let color = 'cyan'; // default color
    
    // Determine color based on action
    switch (action) {
      case 'processing':
        color = 'blue';
        break;
      case 'reported':
        color = 'green';
        break;
      case 'cached':
        color = 'yellow';
        break;
      case 'delayed-report':
        color = 'magenta';
        break;
      case 'not-reported':
        color = 'gray';
        break;
      default:
        if (cachedCount) {
          status = `cached:${cachedCount}`;
          color = 'yellow';
        }
        break;
    }
    
    // Compact format without labels
    const message = `Tag ${status}: ${tagId?.padEnd(26) || 'unknown'} | ${hostname?.padEnd(12) || 'unknown'} | ${String(uniqueCount || 0).padStart(3, '0')}`;
    
    // Format with timestamp and level, then apply color to the entire formatted message
    const timestamp = config.logging.enableTimestamp ? `[${this.timestamp()}]` : '';
    const prefix = this.colorize(`[INFO]`, this.getLevelColor('info'));
    const formattedMessage = `${timestamp} ${prefix} ${message}`;
    
    console.log(this.colorize(formattedMessage, color));
  }

  // Modern structured logging for server actions
  server(action, target, status) {
    const statusColor = status === 'ok' ? 'green' : 'red';
    const message = `Server ${action}: ${target} (${status})`;
    console.log(this.colorize(message, statusColor));
  }
}

module.exports = new Logger(); 