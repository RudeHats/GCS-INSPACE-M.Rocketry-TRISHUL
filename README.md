# Ground Control Station (GCS) - Trishul Dashboard 🚀

Welcome to the **Trishul Dashboard** repository. This is a high-performance, real-time Ground Control Station (GCS) software tailored for CanSat, Rocket, and custom aerospace payload telemetry operations.

Designed with a robust web-based architecture, this dashboard excels at ingesting raw serial telemetry streams and rendering them through a comprehensive, fully interactive UI built using modern web libraries.

## 🌟 Key Features

### 1. 📡 Real-Time Telemetry & Data Visualization
- **Live Graphing:** Utilizes **Chart.js** for high-frequency plotting of Altitude, Pressure, Temperature, Voltage, and Gyroscope data against time.
- **Data Streaming:** Highly optimized WebSocket communication guarantees minimal latency from the ground hardware receiver directly to the UI.
- **Unified CSV Logging:** In-memory optimized buffering engine capable of logging 50k+ rows of mission-critical telemetry into a structurally unified CSV format without browser lag.
- **Offline Data Plotting:** Includes a standalone `CSV_Data_Plotter.html` tool to replay and analyze telemetry dumps post-mission.

### 2. 🌍 Interactive Geospatial Tracking
- **GNSS Mapping:** Powered by **Leaflet.js**, offering real-time 2D plotting of Rocket and CanSat geographical coordinates.
- **Distance Calculations:** Real-time distance resolution between Rocket, CanSat, and the Ground Station.
- **Manual Coordinates Calibration:** Set ground station parameters interactively via Map Controls.

### 3. 🚀 3D Spatial Orientation
- **Digital Twin:** Real-time 3D models of the CanSat and Rocket rendered directly in the browser via **Three.js**.
- **Attitude Indicators:** Visualize accurate Roll, Pitch, and Yaw based on the onboard IMU stream (GXs, GYs, GZs).

### 4. ⚡ High-Performance Architecture
- **Web Workers & Caching:** A dedicated Service Worker (`sw.js`) ensures critical assets (fonts, icons, stylesheets) are heavily cached for robust offline and field-deployment usage.
- **Efficient DOM Rendering:** Implements layout and paint containment optimizations (`contain: layout style paint`) allowing smooth UI framing even with dense sensor inputs.

## 🛠️ Technology Stack
- **Frontend Core:** HTML5, CSS3 (Custom Glass-morphism aesthetics), Vanilla Javascript (ES6+)
- **Data Visualization:** `Chart.js` (2D Plots), `Three.js` (3D Models)
- **Mapping:** `Leaflet.js` (Online/Offline map tiles fallback)
- **Backend/Communication:** Designed to interface with Node.js (`express`, `ws`, `serialport`)

*(Note: The `electron` application wrapper has been explicitly excluded from this repository to focus purely on the core Dashboard features.)*

## 🚀 Getting Started

### Prerequisites
1. [Node.js](https://nodejs.org/) (v16.x or newer).
2. Existing Serial backend stream capable of serving telemetry over WebSockets on `ws://localhost:<PORT>`.

### Usage
Since this repo contains the frontend suite:
1. Clone the repository:
   ```bash
   git clone https://github.com/RudeHats/Software_v_01.git
   ```
2. Serve the `frontend` directory using any local web server. For example:
   ```bash
   npx serve frontend/
   ```
3. Open `http://localhost:3000/gui.html` in your browser. (The dashboard will attempt to connect to its configured WebSocket port).

### Building Your Own GCS?
Check out our comprehensive [Building a GCS Guide](Building_a_GCS_Guide.md) for architectural blueprints and step-by-step instructions on creating a customized telemetry station based on this architecture.

## 📜 License
This project is licensed under the **ISC License**.
