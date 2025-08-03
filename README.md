# RFID On-Premise Processing System

A comprehensive, self-contained RFID processing system designed for on-premise deployment with real-time MQTT processing, Firebase integration, and automated updates.

## 🏗️ Architecture

This system consists of several microservices working together:

- **Mosquitto MQTT Broker**: Real-time message queuing for RFID tags
- **Redis**: Caching and retry queue management
- **Firebase Gateway**: Centralized Firebase access and configuration management
- **RFID Processor**: Tag processing with deduplication and metrics collection
- **Update Service**: Automated system updates with safety checks

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- Firebase project with Firestore enabled
- Invitation code for authentication

### Environment Setup

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Configure your environment variables:
```bash
# Required Firebase Configuration
FIREBASE_DATABASEURL=your-firebase-database-url
FIREBASE_API_KEY=your-firebase-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your-sender-id
FIREBASE_APP_ID=your-app-id
FIREBASE_FUNCTIONS_URL=https://europe-west2-your-project.cloudfunctions.net

# Application Configuration
COMPANY_ID=your-company-id
LOCATIONNAME=your-location-name
INVITATION_CODE=your-invitation-code

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0

# MQTT Configuration
MQTT_HOST=mosquitto
MQTT_PORT=1883
MQTT_TOPIC=rfid/tags
MQTT_TOPIC_MOBILE=rfid/tags/mobile
```

3. Start the system:
```bash
docker-compose up -d
```

## 📋 Services

### Firebase Gateway (`firebase-gateway`)
- **Port**: Internal only (no external access)
- **Purpose**: Centralized Firebase access and configuration management
- **Features**: Real-time configuration updates, authentication, health monitoring

### RFID Processor (`rfid-processor`)
- **Instances**: Fixed and Mobile variants
- **Purpose**: Process RFID tags with deduplication and metrics
- **Features**: MQTT integration, Redis caching, periodic publishing

### Mosquitto MQTT Broker
- **Port**: 1883 (MQTT), 9001 (WebSocket)
- **Purpose**: Real-time message queuing
- **Features**: Persistent storage, logging

### Redis
- **Port**: 6379
- **Purpose**: Caching and retry queue management
- **Features**: Persistence, memory management, health checks

### Update Service
- **Purpose**: Automated system updates
- **Features**: GitHub integration, safety checks, rollback capability

## 🔧 Configuration

### Real-time Configuration Updates

The system supports real-time configuration updates through Firebase Gateway:

```json
{
  "deduplicate": true,
  "deduplicate_interval": 5,
  "update_strategy": "latest",
  "auto_update": true,
  "update_window": {
    "startHour": 2,
    "endHour": 6
  }
}
```

### Environment Variables

See `.env.example` for all available configuration options.

## 🔒 Security Considerations

⚠️ **Important**: This system is designed for on-premise deployment. For production use:

1. **Secure Redis**: Redis is isolated in internal network (no external access)
2. **MQTT Security**: MQTT broker exposed for external devices, internal services use secure network
3. **Network Security**: Internal services use isolated network, external access controlled
4. **Docker Security**: Docker socket access limited to read-only for updates
5. **Environment Variables**: Use secure secret management

### Network Architecture

The system uses a **dual-network approach** for security:

- **Internal Network (`rfid-internal`)**: 
  - Redis (no external access)
  - Firebase Gateway (can reach external Firebase)
  - RFID Processors (can reach both Redis and MQTT)
  - Update Service (can reach Redis)

- **External Access**:
  - MQTT Broker: Ports 1883, 9001 (for external RFID devices)
  - All services can reach external services (Firebase, GitHub) as needed

## 📊 Monitoring

### Health Checks

- **Firebase Gateway**: `GET /health`
- **Redis**: Built-in health check
- **All Services**: Docker health checks configured

### Metrics

The system collects and publishes:
- Health metrics (every 60s)
- Statistics metrics (every 5 minutes)
- Summary metrics (every 15 minutes)

## 🔄 Updates

The system supports automated updates with:
- **Safety Checks**: Service health validation
- **Rollback Capability**: Automatic rollback on failure
- **Update Windows**: Configurable update timing
- **Version Control**: GitHub release integration

## 🧪 Testing

Run tests for individual services:

```bash
# Firebase Gateway tests
cd firebase-gateway && npm test

# RFID Processor tests
cd rfid-processor && npm test
```

## 📝 API Documentation

### Firebase Gateway API

- `GET /health` - System health check
- `GET /api/config/status` - Configuration status
- `GET /api/config/location/:locationName` - Get location config
- `PUT /api/config/location/:locationName` - Update location config

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For issues and questions:
1. Check the service-specific README files
2. Review the logs: `docker-compose logs [service-name]`
3. Open an issue on GitHub

## 🔄 Version History

- **v1.0.01**: Initial release with core functionality 