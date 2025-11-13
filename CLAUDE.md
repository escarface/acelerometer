# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Progressive Web App (PWA) that visualizes real-time accelerometer data from mobile devices. The app displays X, Y, and Z axis acceleration values and plots them on a live-updating chart using Chart.js.

## Architecture

### Core Components

1. **index.html** - Main HTML structure with:
   - Three axis value displays (X, Y, Z)
   - Canvas element for Chart.js visualization
   - Start/Stop button for monitoring control
   - External Chart.js library loaded via CDN

2. **app.js** - Main application logic implementing:
   - Device motion event handling via `DeviceMotionEvent` API
   - Permission request flow (required for iOS 13+)
   - Real-time chart updates with rolling window of last 100 data points
   - Chart.js configuration with line chart showing all three axes
   - Service Worker registration for PWA functionality

3. **service-worker.js** - PWA caching strategy:
   - Cache-first approach for offline functionality
   - Caches all static assets plus Chart.js CDN resource
   - Version-based cache management (`CACHE_NAME = 'accelerometer-app-v1'`)

4. **manifest.json** - PWA configuration:
   - Defines app name, icons, theme colors
   - Sets display mode to "standalone" and portrait orientation

### Key Technical Details

- **Data Flow**: `DeviceMotionEvent` → `handleMotion()` → `updateValues()` + `updateChart()`
- **Chart Updates**: Uses `chart.update('none')` mode for optimal performance (no animations)
- **Data Management**: Maintains rolling window of `MAX_DATA_POINTS` (100) data points using array shift operations
- **Acceleration Data**: Uses `event.acceleration` (without gravity) rather than `accelerationIncludingGravity`

## Development

### Running Locally

This is a static web app with no build process. To test locally, you need an HTTP server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js (if http-server is installed)
npx http-server -p 8000
```

Then open `http://localhost:8000` in your browser.

### Testing on Mobile Devices

Since this app uses the accelerometer API, it must be tested on actual mobile devices:

1. Ensure the server is accessible on your local network
2. Access via `https://` (required for sensor APIs) or use local network IP
3. For iOS devices, you'll need to grant permission when prompted

### Updating Service Worker Cache

When making changes to static files, increment the `CACHE_NAME` version in service-worker.js:1 to ensure users get the latest version:

```javascript
const CACHE_NAME = 'accelerometer-app-v2'; // Increment version
```

## Important Constraints

- **HTTPS Required**: DeviceMotion API requires secure context (HTTPS or localhost)
- **iOS Permissions**: iOS 13+ requires explicit permission via `DeviceMotionEvent.requestPermission()`
- **Browser Support**: Not all browsers/devices support accelerometer access
- **CDN Dependency**: Chart.js is loaded from CDN (https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js)
