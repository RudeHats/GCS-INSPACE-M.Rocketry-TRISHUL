# Comprehensive Guide to Building a Ground Control Station (GCS)

Building a Ground Control Station (GCS) for aerospace projects (such as Rockets, CanSats, or Drones) requires bridging the gap between hardware (radio receivers) and software (data visualization). 

This guide breaks down the architecture and concepts used in the **Trishul Dashboard**, serving as a blueprint for building your own GCS.

---

## 🏗️ Architectural Blueprint

A resilient GCS operates on a **Node/Web Architecture**. Rather than building bulky native desktop applications, utilizing a local web server allows for rapid UI development, access to rich visualization libraries, and easy cross-platform compatibility.

### 1. Hardware Interface Layer (The Backend)
Your Ground Station receiver antenna receives RF signals (e.g., via LoRa modules) and feeds serial data to your PC via USB.

- **Technology**: Node.js + `serialport`
- **Role**: Open the COM/USB port, listen for incoming byte streams, parse the packets into a structured JSON object.
- **Implementation**:
  ```javascript
  const SerialPort = require('serialport');
  const port = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 115200 });
  
  port.on('data', function (data) {
      // Parse the raw comma-separated string into a Javascript Object
      let parsedData = parseTelemetry(data.toString());
      // Send parsedData to the frontend
  });
  ```

### 2. Communication Layer
You need a low-latency mechanism to send data from the backend to the frontend UI.
- **Technology**: WebSockets (`ws` library)
- **Role**: Create a persistent connection between the server and the browser. Every time a new serial packet arrives, the server broadcasts it to all connected frontend clients.

### 3. Visualization Layer (The Frontend)
This is what the operator sees. It must be lag-free, visually distinct, and densely informative.

#### A. The UI Shell
- Build a responsive layout using Vanilla HTML/CSS.
- Use CSS containment for performance (`contain: layout style paint;`) on heavy elements like maps and 3D models. This prevents the browser from recalculating the whole page layout when a single graph updates.

#### B. 2D Data Graphs
- **Library**: [Chart.js](https://www.chartjs.org/)
- **Strategy**: Maintain fixed-sized arrays. When a new data point arrives, push it to the end of the array and `shift()` the oldest element from the beginning.
  ```javascript
  if (chart.data.labels.length > 50) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
  }
  chart.update('none'); // Update without animation for maximum performance
  ```

#### C. Spatial Tracking (Mapping)
- **Library**: [Leaflet.js](https://leafletjs.com/)
- **Strategy**: Cache Map tiles aggressively. Feed it GPS coordinates from the incoming WebSocket JSON. Use custom markers to track multi-vehicle paths (e.g., Rocket trajectory vs CanSat descent).

#### D. Attitude Indication (3D Digital Twins)
- **Library**: [Three.js](https://threejs.org/)
- **Strategy**: Load a `.obj` or `.gltf` 3D model of your rocket. Map the incoming IMU Euler Angles (Roll, Pitch, Yaw) directly to the rotation of the 3D mesh.
  ```javascript
  rocketMesh.rotation.x = THREE.MathUtils.degToRad(incomingPitch);
  rocketMesh.rotation.y = THREE.MathUtils.degToRad(incomingYaw);
  rocketMesh.rotation.z = THREE.MathUtils.degToRad(incomingRoll);
  ```

#### E. Data Logging
Do not underestimate the criticality of Mission Logs.
- Avoid logging everything to the Hard Drive iteratively using browser APIs if operating at extremely high Hz (it can cause blocking).
- **Pro Tip**: Use in-memory buffers (`let csvBuffer = []`), flush them to a Blob at set intervals (e.g., every 5 seconds), and utilize the browser's download functionality to export the final `.csv` dump.

---

## 🛠️ Performance Optimizations (Lessons Learned)

When building a high-frequency GCS (e.g., >10 Hz telemetry), browsers will struggle if not optimized:

1. **Avoid DOM Thrashing**: Do not update text on the screen (`innerHTML` or `textContent`) every single millisecond. Implement a rate-limiter for the UI (Update the text indicators at maximum 10fps, even if data comes at 50fps).
2. **Preload Assets**: Ensure all fonts, icons, and libraries are stored locally and preloaded. Web-calls to CDNs in the field with poor internet will crash your layout.
3. **Garbage Collection Constraints**: Do not create new Arrays or Objects repeatedly inside your high-frequency render loops. Reuse existing variables to prevent the JS Garbage Collector from stuttering your graphs.
4. **Offline Capability**: Use a Service Worker (`sw.js`) to cache the entire directory. Your GCS must work flawlessly in the middle of a desert without Wi-Fi.

## 🏁 Final Thoughts
By adopting WebSockets over Serial and relying on hardware-accelerated WebGL modules like Three.js, building a modern ground station is highly accessible. Keep computations in the UI thread lean, rely on the backend to do the heavy string parsing, and always design for maximum contrast and offline resilience.
