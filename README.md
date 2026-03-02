# CanSat Dashboard 🚀

Welcome to the **CanSat Dashboard** repository. This powerful application is designed to act as the primary Ground Control Station (GCS) telemetry dashboard for CanSat, Rocket, and other payload deployments. It features modern architecture bridging serial communication and expressive UI rendering.

## 🌟 Features
- **Real-Time Data Plotting**: Advanced streaming and data visualization of incoming sensor telemetry from serial interfaces.
- **Interactive Mapping**: Geographic plotting using Leaflet.js to monitor payload trajectory and live location data.
- **CSV Data Processing**: Fast and reliable onboard data viewing with the `CSV_Data_Plotter.html` tool.
- **Robust Backend Services**: Engineered using Node.js, Express, and modern WebSockets to enable rapid integration.

> [!NOTE] 
> This repository houses the Core Dashboard interface, mapping scripts, and backend servers. The Electron wrapper has been intentionally excluded from this standalone source map.

## 🛠️ Technology Stack
- **Languages**: HTML5, CSS3, JavaScript (ES6+)
- **Frontend Core**: Interactive DOM rendering, Leaflet Map integration, Charting utilities.
- **Backend Handlers**: `Express.js`, `ws` for Websockets, `serialport` for serial parsing.

## 🚀 Getting Started

### Prerequisites
1. [Node.js](https://nodejs.org/) (v16.x or newer is recommended).
2. Existing Serial connection/telemetry hardware simulator (if running live).

### Installation

1. Clean install all dashboard dependencies via npm:
   ```bash
   npm install
   ```
2. Start the core frontend logic or backend server processes directly using Node (or serve via any local http-server).

### Usage
- Run the web-based visualizer natively using an HTTP server to inspect UI elements.
- Analyze collected data dumps via the included `CSV_Data_Plotter.html`.

## 📜 License
This project is licensed under the **ISC License**.
