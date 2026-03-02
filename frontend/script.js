/**
 * TRISHUL DASHBOARD - CLIENT-SIDE LOGIC
 *
 * This script manages:
 * - WebSocket connection to the backend server (app.js)
 * - Populating serial port dropdowns with USB auto-recognition
 * - Handling connection/disconnection to Rocket and Cansat ports
 * - Receiving and parsing telemetry data for both devices according to updateData.txt
 * - Updating all GUI elements (gauges, charts, maps, text fields)
 * - Tab navigation between Telemetry/Graphs/Maps
 * - Map and chart initialization
 * - Real-time data parsing and display
 */

// --- GLOBAL STATE ---
let socket;
let map;
let rocketMarker, cansatMarker, groundStationMarker;
let charts = {};
let isStarted = false;
let rawLogData = [];
let simulationMode = false;
let simulationData = [];
let simInterval;
let groundStationCoords = null;
let lastRocketCoords = null;
let lastCansatCoords = null;

// Optimized CSV logging state with memory management
let csvLogging = false;
let csvData = [];
let csvBuffer = [];
let csvFlushInterval = null;
let csvRowCount = 0;

// Per-source CSV storage
let csvDataRocket = [];
let csvDataCansat = [];
let csvBufferRocket = [];
let csvBufferCansat = [];
// teamId removed - will use actual team_id from data

// CSV logging state - using in-memory buffer for compatibility

// Separate counters for Rocket and Cansat data validation
let csvCounters = {
    rocket: 0,
    cansat: 0,
    total: 0
};

// CSV validation and monitoring
let csvValidation = {
    lastRocketTime: null,
    lastCansatTime: null,
    errors: [],
    warnings: []
};
// CSV headers matching updateData.txt structure exactly - SINGLE FILE with Source column
let csvHeaders = {
    rocket: ['Timestamp', 'TEAM_ID', 'MISSION_TIME', 'PACKET_NO', 'ALTITUDE', 'PRESSURE', 'TEMP', 'BATTERY_VOLTAGE', 'GPS_TIME', 'GPS_LAT', 'GPS_LON', 'GPS_ALT', 'GPS_SATS', 'AX', 'AY', 'AZ', 'GXS', 'GYS', 'GZS', 'FLIGHTSOFTWARE_STATUS', 'SURFACE_TEMP', 'SMOKE', 'CARBON_DIOXIDE', 'AMMONIA', 'PITCH', 'ROLL', 'YAW'],
    cansat: ['Timestamp', 'TEAM_ID', 'TIME_STAMP', 'PACKET_NO', 'ALTITUDE', 'PRESSURE', 'TEMP', 'BATTERY_VOLTAGE', 'GPS_TIME', 'GPS_LAT', 'GPS_LON', 'GPS_ALT', 'GPS_SATS', 'AX', 'AY', 'AZ', 'GXS', 'GYS', 'GZS', 'FLIGHTSOFTWARE_STATUS', 'METHANE', 'CARBON_MONOXIDE', 'AMMONIA', 'CARBON_DIOXIDE', 'PITCH', 'ROLL', 'YAW']
};

// Unified header for single CSV file with Source column prefix
// Includes both MISSION_TIME (Rocket) and TIME_STAMP (Cansat) fields
const unifiedCsvHeader = ['Source', 'Timestamp', 'TEAM_ID', 'MISSION_TIME', 'TIME_STAMP', 'PACKET_NO', 'ALTITUDE', 'PRESSURE', 'TEMP', 'BATTERY_VOLTAGE', 'GPS_TIME', 'GPS_LAT', 'GPS_LON', 'GPS_ALT', 'GPS_SATS', 'AX', 'AY', 'AZ', 'GXS', 'GYS', 'GZS', 'FLIGHTSOFTWARE_STATUS', 'SURFACE_TEMP', 'SMOKE', 'CARBON_DIOXIDE', 'AMMONIA', 'METHANE', 'CARBON_MONOXIDE', 'PITCH', 'ROLL', 'YAW'];


// Optimized memory management constants for 50,000+ rows
const CSV_BUFFER_SIZE = 5000; // Flush every 5000 rows for better performance
const MAX_MEMORY_ROWS = 100000; // Increased to handle 50,000+ rows efficiently
const MEMORY_CLEANUP_INTERVAL = 10000; // More frequent cleanup every 10 seconds
const CSV_FLUSH_INTERVAL = 500; // Flush buffer every 500ms for real-time logging

// Data history for charts
let dataHistory = {
    timestamps: [],
    rocket: {
        altitude: [],
        pressure: [],
        temp: [],
        voltage: [],
        gxs: [],
        gys: [],
        gzs: []
    },
    cansat: {
        altitude: [],
        pressure: [],
        temp: [],
        voltage: [],
        gxs: [],
        gys: [],
        gzs: []
    }
};

let uiCache = {
    header: {},
    rocket: {},
    cansat: {}
};

// Global telemetry state for render loop
let telemetryState = {
    rocket: null,
    cansat: null
};

// Optimized render loop control
let renderLoopRunning = false;
let renderLoopId = null;
let lastFrameTime = 0;
let frameCount = 0;
let performanceMonitor = {
    lastCheck: 0,
    frameRate: 0,
    updateCount: 0
};

// --- Rate limiting for different update types ---
const RATE_LIMITS = {
    ui: 100,        // 10 Hz for UI updates (more responsive)
    charts: 1000,   // 1 Hz for charts (performance)
    csv: 1000       // 1 Hz for CSV logging (performance)
};
const RATE_STATE = {
    ui: { rocket: 0, cansat: 0 },
    charts: { rocket: 0, cansat: 0 },
    csv: { rocket: 0, cansat: 0 }
};

function shouldProcess(group, source, now) {
    const last = RATE_STATE[group][source] || 0;
    const interval = RATE_LIMITS[group] || 1000;
    if (now - last >= interval) {
        RATE_STATE[group][source] = now;
        return true;
    }
    return false;
}

// Store last known coordinates for distance calculation
let lastCoordinates = {
    rocket: null, // { lat, lon }
    cansat: null, // { lat, lon }
    ground: null  // { lat, lon }
};

const MAX_CHART_POINTS = 300; // Max data points to show on charts
const CHART_TIME_WINDOW = 30; // Show last 30 seconds of data

// Flight state mapping according to updateData.txt
const FLIGHT_STATES = {
    0: 'LAUNCH_PAD',
    1: 'ASCENT',
    2: 'DROUGE_DEPLOYED',
    3: 'DESCENT',
    4: 'MAIN_PARA_DEPLOYED',
    5: 'IMPACT'
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    logToConsole('Dashboard initialized. Connecting to WebSocket server...');
    initializeUICache();
    initializeServiceWorker();
    connectWebSocket();
    initializeCharts();
    initializeMap();
    addEventListeners();
    // Ensure terminal is black with green text without touching style.css
    const logEl = document.getElementById('log');
    if (logEl) {
        logEl.style.backgroundColor = '#000000';
        logEl.style.color = '#00ff00';
        logEl.style.fontFamily = "Courier New, monospace";
    }
    // Single page layout - no tab switching needed
    // Start CSV logging automatically
    startCSVLogging();
    
    // Performance optimization: Start performance monitoring
    setInterval(logPerformanceMetrics, 5000); // Log every 5 seconds
});

// --- SERVICE WORKER & CACHING ---

/**
 * Initializes service worker for offline functionality and caching
 */
async function initializeServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            // Register service worker
            const registration = await navigator.serviceWorker.register('/sw.js');
            logToConsole('Service Worker registered successfully', 'success');
            
            // Cache critical resources
            await cacheCriticalResources();
            
        } catch (error) {
            logToConsole(`Service Worker registration failed: ${error.message}`, 'error');
        }
    } else {
        logToConsole('Service Worker not supported, using fallback caching', 'warning');
        // Fallback: use browser cache API
        await cacheCriticalResourcesFallback();
    }
}

/**
 * Caches critical resources for offline functionality
 */
async function cacheCriticalResources() {
    const criticalResources = [
        '/libs/font-awesome.css',
        '/libs/webfonts/fa-solid-900.woff2',
        '/libs/webfonts/fa-regular-400.woff2',
        '/libs/webfonts/fa-brands-400.woff2',
        '/libs/chart.js',
        '/libs/leaflet.js',
        '/libs/leaflet.css',
        '/libs/iceland-font.css',
        '/style.css',
        '/script.js',
        '/assets/rocket.png',
        '/assets/cansat.png'
    ];
    
    try {
        const cache = await caches.open('cansat-dashboard-v1');
        await cache.addAll(criticalResources);
        logToConsole(`Cached ${criticalResources.length} critical resources`, 'success');
    } catch (error) {
        logToConsole(`Failed to cache resources: ${error.message}`, 'error');
    }
}

/**
 * Fallback caching method for browsers without service worker support
 */
async function cacheCriticalResourcesFallback() {
    const criticalResources = [
        '/libs/font-awesome.css',
        '/libs/webfonts/fa-solid-900.woff2',
        '/libs/webfonts/fa-regular-400.woff2',
        '/libs/webfonts/fa-brands-400.woff2',
        '/libs/chart.js',
        '/libs/leaflet.js',
        '/libs/leaflet.css',
        '/libs/iceland-font.css',
        '/style.css',
        '/script.js',
        '/assets/rocket.png',
        '/assets/cansat.png'
    ];
    
    try {
        // Preload resources using link preload
        criticalResources.forEach(resource => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = resource;
            
            if (resource.endsWith('.css')) {
                link.as = 'style';
            } else if (resource.endsWith('.js')) {
                link.as = 'script';
            } else if (resource.endsWith('.png') || resource.endsWith('.jpg') || resource.endsWith('.jpeg')) {
                link.as = 'image';
            }
            
            document.head.appendChild(link);
        });
        
        logToConsole(`Preloaded ${criticalResources.length} critical resources`, 'success');
    } catch (error) {
        logToConsole(`Failed to preload resources: ${error.message}`, 'error');
    }
}

// --- OPTIMIZED CSV LOGGING FUNCTIONS ---

/**
 * Starts memory-optimized CSV logging with streaming
 */
async function startCSVLogging() {
    try {
        csvLogging = true;
        csvData = [];
        csvBuffer = [];
        csvRowCount = 0;
        csvDataRocket = [];
        csvDataCansat = [];
        csvBufferRocket = [];
        csvBufferCansat = [];
        csvCounters.rocket = 0;
        csvCounters.cansat = 0;
        csvCounters.total = 0;
        
        // Use in-memory storage (no File System Access API)
        logToConsole('CSV logging started. Click Stop CSV Log to download file.', 'success');
        
        // Start periodic status updates
        csvFlushInterval = setInterval(updateCSVStatus, 1000);
        
        // Initialize and show CSV status indicator
        updateCSVStatus();
        
    } catch (error) {
        logToConsole(`Error starting CSV logging: ${error.message}`, 'error');
        csvLogging = false;
    }
}

/**
 * Memory-optimized CSV logging with buffering
 */
/**
 * Helper function to get the data-to-header mapping.
 */

/**
 * Memory-optimized CSV logging with buffering (unified row per packet)
 */
async function logToCSV(data, source) {
    if (!csvLogging) return;

    try {
        const validationErrors = validateCSVData(data, source);
        if (validationErrors.length > 0) {
            logToConsole(`CSV validation errors for ${source}: ${validationErrors.join(', ')}`, 'warning');
        }

        const timestamp = new Date().toISOString();
        const isRocket = source === 'rocket';

        // Map data to unified CSV header - matches backend field names exactly
        const fieldMap = {
            'Source': source,
            'Timestamp': timestamp,
            'TEAM_ID': data.team_id || '',
            'MISSION_TIME': isRocket ? (data.mission_time || '') : '',
            'TIME_STAMP': isRocket ? '' : (data.timestamp || ''),
            'PACKET_NO': isRocket ? (data.packet_no || '') : (data.packet_count || ''),
            'ALTITUDE': data.altitude || '',
            'PRESSURE': data.pressure || '',
            'TEMP': data.temp || '',
            'BATTERY_VOLTAGE': isRocket ? (data.battery_voltage || '') : (data.voltage || ''),
            'GPS_TIME': isRocket ? (data.gps_time || '') : (data.gnss_time || ''),
            'GPS_LAT': isRocket ? (data.gps_lat || '') : (data.gnss_latitude || ''),
            'GPS_LON': isRocket ? (data.gps_lon || '') : (data.gnss_longitude || ''),
            'GPS_ALT': isRocket ? (data.gps_alt || '') : (data.gnss_altitude || ''),
            'GPS_SATS': isRocket ? (data.gps_sats || '') : (data.gnss_sats || ''),
            'AX': data.ax || '',
            'AY': data.ay || '',
            'AZ': data.az || '',
            'GXS': data.gxs || '',
            'GYS': data.gys || '',
            'GZS': data.gzs || '',
            'FLIGHTSOFTWARE_STATUS': isRocket ? (data.flight_status || '') : (data.flight_state || ''),
            'SURFACE_TEMP': isRocket ? (data.surface_temp || '') : '',
            'SMOKE': isRocket ? (data.smoke || '') : '',
            'CARBON_DIOXIDE': isRocket ? (data.co2 || '') : (data.carbon_dioxide || ''),
            'AMMONIA': isRocket ? (data.nh3 || '') : (data.ammonia || ''),
            'METHANE': isRocket ? '' : (data.methane || ''),
            'CARBON_MONOXIDE': isRocket ? '' : (data.carbon_monoxide || ''),
            'PITCH': data.pitch || '',
            'ROLL': data.roll || '',
            'YAW': data.yaw || ''
        };

        // Create the row by looking up each header in our map
        const unifiedRow = unifiedCsvHeader.map(header => fieldMap[header] || '');

        // Add the formatted row to the correct buffer
        if (source === 'rocket') {
            csvBufferRocket.push(unifiedRow.join(','));
        } else if (source === 'cansat') {
            csvBufferCansat.push(unifiedRow.join(','));
        } else {
            return; // Should not happen
        }
        
        csvRowCount++;
        csvCounters[source]++;
        csvCounters.total++;
        csvValidation[`last${source.charAt(0).toUpperCase() + source.slice(1)}Time`] = new Date().toISOString();
        
        updateCSVStatus();
        if (csvRowCount % 100 === 0) {
            logCSVValidationStatus();
        }
        
    } catch (error) {
        logToConsole(`Error logging to CSV: ${error.message}`, 'error');
    }
}

/**
 * Updates CSV status indicator with detailed counters
 */
function updateCSVStatus() {
    const countEl = document.getElementById('csv-count');
    const rocketCountEl = document.getElementById('csv-count-rocket');
    const cansatCountEl = document.getElementById('csv-count-cansat');
    
    if (countEl) {
        countEl.textContent = csvRowCount.toLocaleString();
    }
    if (rocketCountEl) {
        rocketCountEl.textContent = csvCounters.rocket.toLocaleString();
    }
    if (cansatCountEl) {
        cansatCountEl.textContent = csvCounters.cansat.toLocaleString();
    }
    
    // Update CSV status with detailed row information
    const statusEl = document.getElementById('csv-status');
    if (statusEl) {
        const totalRows = csvRowCount;
        const rocketRows = csvCounters.rocket;
        const cansatRows = csvCounters.cansat;
        const bufferRows = csvBufferRocket.length + csvBufferCansat.length;
        
        // Update storage information
        const storageInfoEl = document.getElementById('csv-storage-info');
        if (storageInfoEl) {
            if (csvLogging) {
                storageInfoEl.textContent = `Active (${bufferRows} buffered)`;
                storageInfoEl.style.color = '#00aa00';
            } else {
                storageInfoEl.textContent = 'Ready';
                storageInfoEl.style.color = '#666';
            }
        }
    }
}

/**
 * Validates CSV row integrity and data quality
 */
function validateCSVRowIntegrity(csvRow, source) {
    try {
        const fields = csvRow.split(',');
        const expectedFields = unifiedCsvHeader.length;
        
        // Check field count
        if (fields.length !== expectedFields) {
            csvValidation.errors.push(`${source}: Field count mismatch (${fields.length}/${expectedFields})`);
        }
        
        // Check for empty critical fields
        const criticalFields = source === 'rocket' ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]; // Timestamp, TEAM_ID, MISSION_TIME/TIME_STAMP, PACKET_NO, ALTITUDE, PRESSURE, TEMP
        criticalFields.forEach(index => {
            if (index < fields.length && (!fields[index] || fields[index].trim() === '')) {
                csvValidation.warnings.push(`${source}: Empty critical field at position ${index}`);
            }
        });
        
        // Check timestamp format
        if (fields[0] && !fields[0].includes('T') && !fields[0].includes(':')) {
            csvValidation.warnings.push(`${source}: Invalid timestamp format: ${fields[0]}`);
        }
        
        // Limit error/warning arrays to prevent memory issues
        if (csvValidation.errors.length > 100) {
            csvValidation.errors = csvValidation.errors.slice(-50);
        }
        if (csvValidation.warnings.length > 100) {
            csvValidation.warnings = csvValidation.warnings.slice(-50);
        }
        
    } catch (error) {
        csvValidation.errors.push(`${source}: Validation error - ${error.message}`);
    }
}

/**
 * Logs CSV validation status for monitoring
 */
function logCSVValidationStatus() {
    const now = new Date();
    const rocketAge = csvValidation.lastRocketTime ? 
        Math.round((now - new Date(csvValidation.lastRocketTime)) / 1000) : 'Never';
    const cansatAge = csvValidation.lastCansatTime ? 
        Math.round((now - new Date(csvValidation.lastCansatTime)) / 1000) : 'Never';
    
    console.log(`[CSV VALIDATION] Total: ${csvRowCount} | Rocket: ${csvCounters.rocket} (${rocketAge}s ago) | Cansat: ${csvCounters.cansat} (${cansatAge}s ago)`);
    
    if (csvValidation.errors.length > 0) {
        console.warn(`[CSV ERRORS] ${csvValidation.errors.length} errors:`, csvValidation.errors.slice(-3));
    }
    if (csvValidation.warnings.length > 0) {
        console.warn(`[CSV WARNINGS] ${csvValidation.warnings.length} warnings:`, csvValidation.warnings.slice(-3));
    }
}

/**
 * Validates CSV data integrity for accurate parsing
 */
function validateCSVData(data, source) {
    const errors = [];
    
    // Check for required fields - Updated to match actual data structure
    const requiredFields = source === 'rocket' ? 
        ['team_id', 'mission_time', 'packet_no', 'altitude', 'pressure', 'temp', 'flight_status'] :
        ['team_id', 'timestamp', 'packet_count', 'altitude', 'pressure', 'temp', 'flight_status'];
    
    requiredFields.forEach(field => {
        if (data[field] === undefined || data[field] === null) {
            errors.push(`Missing required field: ${field}`);
        }
    });
    
    // Validate numeric fields
    const numericFields = ['altitude', 'pressure', 'temp', 'ax', 'ay', 'az'];
    numericFields.forEach(field => {
        if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
            const num = parseFloat(data[field]);
            if (isNaN(num)) {
                errors.push(`Invalid numeric value for ${field}: ${data[field]}`);
            }
        }
    });
    
    // Validate orientation angles
    const orientationFields = ['pitch', 'roll', 'yaw'];
    orientationFields.forEach(field => {
        if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
            const angle = parseFloat(data[field]);
            if (!isNaN(angle) && (angle < -180 || angle > 180)) {
                errors.push(`Invalid angle for ${field}: ${angle} (must be -180 to 180)`);
            }
        }
    });
    
    return errors;
}

/**
 * Performance test function for CSV logging with large datasets
 */
function testCSVPerformance() {
    console.log('Starting CSV performance test for 50,000 rows...');
    
    const startTime = performance.now();
    const testRows = 50000;
    let processedRows = 0;
    
    // Generate test data
    const generateTestData = (index, source) => ({
        team_id: 'TEST_001',
        mission_time: `2025-${String(index % 12 + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        packet_no: index,
        altitude: Math.random() * 10000,
        pressure: Math.random() * 1000 + 800,
        temp: Math.random() * 50 - 10,
        battery_voltage: Math.random() * 5 + 3,
        gps_time: `2025-${String(index % 12 + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        gps_lat: Math.random() * 180 - 90,
        gps_lon: Math.random() * 360 - 180,
        gps_alt: Math.random() * 10000,
        gps_sats: Math.floor(Math.random() * 12) + 1,
        ax: Math.random() * 20 - 10,
        ay: Math.random() * 20 - 10,
        az: Math.random() * 20 - 10,
        gxs: Math.random() * 100 - 50,
        gys: Math.random() * 100 - 50,
        gzs: Math.random() * 100 - 50,
        flight_status: Math.floor(Math.random() * 6),
        surface_temp: Math.random() * 50,
        smoke: Math.random() * 1000,
        co2: Math.random() * 1000,
        nh3: Math.random() * 100,
        pitch: Math.random() * 360 - 180,
        roll: Math.random() * 360 - 180,
        yaw: Math.random() * 360 - 180
    });
    
    // Process test data in batches
    const processBatch = async (batchSize) => {
        for (let i = 0; i < batchSize && processedRows < testRows; i++) {
            const testData = generateTestData(processedRows, 'rocket');
            await logToCSV(testData, 'rocket');
            processedRows++;
            
            if (processedRows % 1000 === 0) {
                console.log(`Processed ${processedRows.toLocaleString()} rows...`);
            }
        }
    };
    
    // Process in batches of 1000
    const processAll = async () => {
        while (processedRows < testRows) {
            const remaining = testRows - processedRows;
            const batchSize = Math.min(1000, remaining);
            await processBatch(batchSize);
            
            // Small delay to prevent blocking
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        
        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;
        const rowsPerSecond = Math.round(testRows / duration);
        
        console.log(`Performance test completed:`);
        console.log(`- Total rows: ${testRows.toLocaleString()}`);
        console.log(`- Duration: ${duration.toFixed(2)} seconds`);
        console.log(`- Rate: ${rowsPerSecond.toLocaleString()} rows/second`);
        console.log(`- Memory usage: ${performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : 'N/A'}`);
    };
    
    processAll();
}

// Make test functions globally available
window.testCSVPerformance = testCSVPerformance;
window.testCSVParsing = testCSVParsing;
window.validateCSVSystem = validateCSVSystem;
window.testCSVHighVolume = testCSVHighVolume;

/**
 * Shows detailed CSV storage statistics
 */
function showCSVStats() {
    console.log('=== CSV STORAGE STATISTICS ===');
    console.log(`Total Rows Stored: ${csvRowCount.toLocaleString()}`);
    console.log(`Rocket Rows: ${csvCounters.rocket.toLocaleString()}`);
    console.log(`Cansat Rows: ${csvCounters.cansat.toLocaleString()}`);
    console.log(`Buffer Status:`);
    console.log(`  - Rocket Buffer: ${csvBufferRocket.length} rows`);
    console.log(`  - Cansat Buffer: ${csvBufferCansat.length} rows`);
    console.log(`  - Total Buffered: ${csvBufferRocket.length + csvBufferCansat.length} rows`);
    console.log(`CSV Logging: ${csvLogging ? 'Active' : 'Inactive'}`);
    
    if (csvLogging) {
        console.log(`✅ CSV logging active (${csvCounters.total} rows stored in memory)`);
    } else {
        console.log('ℹ️ CSV logging not active');
    }
    console.log('===============================');
}

// Make CSV stats function globally available
window.showCSVStats = showCSVStats;

/**
 * Validates CSV data structure and shows sample rows
 */
function validateCSVDataStorage() {
    console.log('=== CSV DATA STORAGE VALIDATION ===');
    
    // Check header structure
    console.log('\n📋 Header Structure:');
    console.log('Unified CSV Header:', unifiedCsvHeader.join(', '));
    console.log('\nRocket Headers:', csvHeaders.rocket.join(', '));
    console.log('Cansat Headers:', csvHeaders.cansat.join(', '));
    
    // Test data mapping
    console.log('\n🧪 Testing Data Mapping:');
    
    const testRocketData = {
        team_id: 'TEAM_001',
        mission_time: '2025-01-15 10:30:00',
        packet_no: 123,
        altitude: 1500.5,
        pressure: 950.2,
        temp: 25.3,
        battery_voltage: 3.7,
        gps_time: '10:30:15',
        gps_lat: 28.7041,
        gps_lon: 77.1025,
        gps_alt: 150.0,
        gps_sats: 12,
        ax: 1.5,
        ay: 0.2,
        az: 9.8,
        gxs: 0.1,
        gys: 0.05,
        gzs: 0.01,
        flight_status: 2,
        surface_temp: 30.0,
        smoke: 100,
        carbon_dioxide: 450,
        ammonia: 25,
        pitch: 10.5,
        roll: 2.3,
        yaw: 45.0
    };
    
    const testCansatData = {
        team_id: 'TEAM_001',
        timestamp: '2025-01-15 10:30:00',
        packet_count: 456,
        altitude: 1400.0,
        pressure: 960.0,
        temp: 24.5,
        voltage: 3.6,
        gnss_time: '10:30:15',
        gnss_latitude: 28.7042,
        gnss_longitude: 77.1026,
        gnss_altitude: 140.0,
        gnss_sats: 11,
        ax: 1.4,
        ay: 0.15,
        az: 9.7,
        gxs: 0.08,
        gys: 0.04,
        gzs: 0.005,
        flight_status: 1,
        methane: 500,
        carbon_monoxide: 50,
        ammonia: 30,
        carbon_dioxide: 440,
        pitch: 9.5,
        roll: 1.8,
        yaw: 42.0
    };
    
    console.log('\n🚀 Rocket Sample Row:');
    const rocketTimestamp = new Date().toISOString();
    const rocketFieldMap = getCsvFieldMap(testRocketData, rocketTimestamp);
    const rocketRow = new Array(unifiedCsvHeader.length).fill('');
    rocketRow[0] = 'rocket';
    csvHeaders.rocket.forEach((header, i) => {
        const mapper = rocketFieldMap[header];
        const value = mapper ? mapper() : '';
        const unifiedIdx = unifiedCsvHeader.indexOf(header);
        if (unifiedIdx !== -1) {
            rocketRow[unifiedIdx] = value;
        }
    });
    console.log(rocketRow.join(','));
    
    console.log('\n📡 Cansat Sample Row:');
    const cansatTimestamp = new Date().toISOString();
    const cansatFieldMap = getCsvFieldMap(testCansatData, cansatTimestamp);
    const cansatRow = new Array(unifiedCsvHeader.length).fill('');
    cansatRow[0] = 'cansat';
    csvHeaders.cansat.forEach((header, i) => {
        const mapper = cansatFieldMap[header];
        const value = mapper ? mapper() : '';
        let unifiedIdx = -1;
        if (header === 'TIME_STAMP') {
            unifiedIdx = unifiedCsvHeader.indexOf('MISSION_TIME');
        } else {
            unifiedIdx = unifiedCsvHeader.indexOf(header);
        }
        if (unifiedIdx !== -1) {
            cansatRow[unifiedIdx] = value;
        }
    });
    console.log(cansatRow.join(','));
    
    console.log('\n✅ CSV Data Storage Validation Complete!');
    console.log('Expected file format: Single CSV with Source column, separate rows for rocket and cansat');
    console.log('===============================');
    
    return {
        header: unifiedCsvHeader,
        rocketSample: rocketRow,
        cansatSample: cansatRow
    };
}

window.validateCSVDataStorage = validateCSVDataStorage;

/**
 * Memory cleanup function
 */
function cleanupMemory() {
    try {
        // Force garbage collection if available
        if (window.gc) {
            window.gc();
        }
        
        // Optimized memory monitoring for large datasets
        if (performance.memory) {
            const memory = performance.memory;
            const usedMB = Math.round(memory.usedJSHeapSize / 1048576);
            const totalMB = Math.round(memory.totalJSHeapSize / 1048576);
            
            // More aggressive memory management for 50K+ rows
            if (usedMB > 200) { // Log if using more than 200MB
                logToConsole(`Memory: ${usedMB}MB used / ${totalMB}MB total (${csvRowCount.toLocaleString()} rows)`, 'info');
                
                // Force additional cleanup if memory usage is high
                if (usedMB > 500) {
                    // Clear old data more aggressively
                    if (csvData.length > MAX_MEMORY_ROWS * 0.8) {
                        const removeCount = Math.floor(csvData.length * 0.2);
                        csvData.splice(1, removeCount);
                        logToConsole(`Aggressive cleanup: removed ${removeCount} old rows`, 'info');
                    }
                }
            }
        }
        
        // Additional cleanup for very large datasets
        if (csvRowCount > 10000) {
            // Clear any unused references
            if (csvBuffer.length === 0) {
                csvBuffer = [];
            }
        }
        
    } catch (error) {
        // Silent fail for memory cleanup
    }
}

/**
 * Gets the current file size for appending
 */
async function getFileSize() {
    try {
        const file = await fileHandle.getFile();
        return file.size;
    } catch {
        return 0;
    }
}

/**
 * Test CSV parsing with sample data to validate structure
 */
function testCSVParsing() {
    console.log('Testing CSV parsing with sample data...');
    
    // Sample rocket data
    const rocketData = {
        team_id: 'TEAM_001',
        mission_time: '2025-10-28 22:21:02',
        packet_no: 22,
        altitude: -117.51,
        pressure: 1004.41,
        temp: 27.76,
        battery_voltage: 0.01,
        gps_time: '10:25:34 IST',
        gps_lat: 26.712024,
        gps_lon: 84.304988,
        gps_alt: 54.1,
        gps_sats: 12,
        ax: 0.04,
        ay: -0.09,
        az: 0.03,
        gxs: 0,
        gys: 0,
        gzs: 0,
        flight_status: 0,
        surface_temp: 0,
        smoke: 0,
        carbon_dioxide: 0,
        ammonia: 0,
        pitch: -0.01,
        roll: 0,
        yaw: 0
    };
    
    // Sample cansat data
    const cansatData = {
        team_id: 'TEAM_001',
        timestamp: '2025-10-28 22:21:02',
        packet_count: 22,
        altitude: -117.51,
        pressure: 1004.41,
        temp: 27.76,
        voltage: 0.01,
        gnss_time: '10:25:34 IST',
        gnss_latitude: 26.712024,
        gnss_longitude: 84.304988,
        gnss_altitude: 54.1,
        gnss_sats: 12,
        ax: 0.04,
        ay: -0.09,
        az: 0.03,
        gxs: 0,
        gys: 0,
        gzs: 0,
        flight_status: 0,
        methane: 0,
        carbon_monoxide: 0,
        ammonia: 0,
        carbon_dioxide: 0,
        pitch: -0.01,
        roll: 0,
        yaw: 0
    };
    
    // Test rocket data parsing
    console.log('Testing rocket data parsing...');
    const rocketHeaders = csvHeaders.rocket;
    const rocketRow = [];
    
    rocketHeaders.forEach(header => {
        const fieldMap = {
            'Timestamp': () => new Date().toISOString(),
            'Rocket_TEAM_ID': () => rocketData.team_id,
            'Rocket_MISSION_TIME': () => rocketData.mission_time,
            'Rocket_PACKET_NO': () => rocketData.packet_no,
            'Rocket_ALTITUDE': () => rocketData.altitude,
            'Rocket_PRESSURE': () => rocketData.pressure,
            'Rocket_TEMP': () => rocketData.temp,
            'Rocket_BATTERY_VOLTAGE': () => rocketData.battery_voltage,
            'Rocket_GPS_TIME': () => rocketData.gps_time,
            'Rocket_GPS_LAT': () => rocketData.gps_lat,
            'Rocket_GPS_LON': () => rocketData.gps_lon,
            'Rocket_GPS_ALT': () => rocketData.gps_alt,
            'Rocket_GPS_SATS': () => rocketData.gps_sats,
            'Rocket_AX': () => rocketData.ax,
            'Rocket_AY': () => rocketData.ay,
            'Rocket_AZ': () => rocketData.az,
            'Rocket_GXS': () => rocketData.gxs,
            'Rocket_GYS': () => rocketData.gys,
            'Rocket_GZS': () => rocketData.gzs,
            'Rocket_FLIGHT_STATUS': () => rocketData.flight_status,
            'Rocket_SURFACE_TEMP': () => rocketData.surface_temp,
            'Rocket_SMOKE': () => rocketData.smoke,
            'Rocket_CARBON_DIOXIDE': () => rocketData.carbon_dioxide,
            'Rocket_AMMONIA': () => rocketData.ammonia,
            'Rocket_PITCH': () => rocketData.pitch,
            'Rocket_ROLL': () => rocketData.roll,
            'Rocket_YAW': () => rocketData.yaw
        };
        
        const mapper = fieldMap[header];
        rocketRow.push(mapper ? mapper() : '');
    });
    
    console.log('Rocket CSV row:', rocketRow.join(','));
    
    // Test cansat data parsing
    console.log('Testing cansat data parsing...');
    const cansatHeaders = csvHeaders.cansat;
    const cansatRow = [];
    
    cansatHeaders.forEach(header => {
        const fieldMap = {
            'Timestamp': () => new Date().toISOString(),
            'Cansat_TEAM_ID': () => cansatData.team_id,
            'Cansat_TIME_STAMP': () => cansatData.timestamp,
            'Cansat_PACKET_NO': () => cansatData.packet_count,
            'Cansat_ALTITUDE': () => cansatData.altitude,
            'Cansat_PRESSURE': () => cansatData.pressure,
            'Cansat_TEMP': () => cansatData.temp,
            'Cansat_BATTERY_VOLTAGE': () => cansatData.voltage,
            'Cansat_GPS_TIME': () => cansatData.gnss_time,
            'Cansat_GPS_LAT': () => cansatData.gnss_latitude,
            'Cansat_GPS_LON': () => cansatData.gnss_longitude,
            'Cansat_GPS_ALT': () => cansatData.gnss_altitude,
            'Cansat_GPS_SATS': () => cansatData.gnss_sats,
            'Cansat_AX': () => cansatData.ax,
            'Cansat_AY': () => cansatData.ay,
            'Cansat_AZ': () => cansatData.az,
            'Cansat_GXS': () => cansatData.gxs,
            'Cansat_GYS': () => cansatData.gys,
            'Cansat_GZS': () => cansatData.gzs,
            'Cansat_FLIGHT_STATUS': () => cansatData.flight_status,
            'Cansat_METHANE': () => cansatData.methane,
            'Cansat_CARBON_MONOXIDE': () => cansatData.carbon_monoxide,
            'Cansat_AMMONIA': () => cansatData.ammonia,
            'Cansat_CARBON_DIOXIDE': () => cansatData.carbon_dioxide,
            'Cansat_PITCH': () => cansatData.pitch,
            'Cansat_ROLL': () => cansatData.roll,
            'Cansat_YAW': () => cansatData.yaw
        };
        
        const mapper = fieldMap[header];
        cansatRow.push(mapper ? mapper() : '');
    });
    
    console.log('Cansat CSV row:', cansatRow.join(','));
    
    console.log('CSV parsing test completed successfully!');
    return { rocketRow, cansatRow };
}

/**
 * Comprehensive CSV validation and monitoring system
 */
function validateCSVSystem() {
    console.log('=== CSV SYSTEM VALIDATION ===');
    console.log(`CSV Logging Active: ${csvLogging}`);
    console.log(`Total Rows: ${csvRowCount.toLocaleString()}`);
    console.log(`Rocket Rows: ${csvCounters.rocket.toLocaleString()}`);
    console.log(`Cansat Rows: ${csvCounters.cansat.toLocaleString()}`);
    console.log(`Buffer Size: ${csvBuffer.length}/${CSV_BUFFER_SIZE}`);
    console.log(`Memory Usage: ${csvData.length.toLocaleString()} rows in memory`);
    
    // Check data freshness
    const now = new Date();
    const rocketAge = csvValidation.lastRocketTime ? 
        Math.round((now - new Date(csvValidation.lastRocketTime)) / 1000) : 'Never';
    const cansatAge = csvValidation.lastCansatTime ? 
        Math.round((now - new Date(csvValidation.lastCansatTime)) / 1000) : 'Never';
    
    console.log(`Last Rocket Data: ${rocketAge}s ago`);
    console.log(`Last Cansat Data: ${cansatAge}s ago`);
    
    // Check for data quality issues
    if (csvValidation.errors.length > 0) {
        console.warn(`Errors: ${csvValidation.errors.length}`);
        csvValidation.errors.slice(-5).forEach(error => console.warn(`  - ${error}`));
    }
    
    if (csvValidation.warnings.length > 0) {
        console.warn(`Warnings: ${csvValidation.warnings.length}`);
        csvValidation.warnings.slice(-5).forEach(warning => console.warn(`  - ${warning}`));
    }
    
    // Memory efficiency check
    const memoryEfficiency = csvRowCount > 0 ? (csvData.length / csvRowCount * 100).toFixed(1) : 0;
    console.log(`Memory Efficiency: ${memoryEfficiency}%`);
    
    // Performance check for 50K+ rows
    if (csvRowCount > 50000) {
        console.log('✅ System handling 50K+ rows efficiently');
    } else if (csvRowCount > 10000) {
        console.log('✅ System handling 10K+ rows efficiently');
    } else {
        console.log('ℹ️ System ready for high-volume logging');
    }
    
    console.log('=============================');
    return {
        totalRows: csvRowCount,
        rocketRows: csvCounters.rocket,
        cansatRows: csvCounters.cansat,
        memoryUsage: csvData.length,
        errors: csvValidation.errors.length,
        warnings: csvValidation.warnings.length,
        rocketAge: rocketAge,
        cansatAge: cansatAge
    };
}

/**
 * Test CSV system with high-volume data simulation
 */
async function testCSVHighVolume() {
    console.log('Testing CSV system with high-volume data...');
    
    const testData = {
        rocket: {
            team_id: 'TEAM_001',
            mission_time: '2025-10-28 22:21:02',
            packet_no: 1,
            altitude: 100,
            pressure: 1000,
            temp: 25,
            battery_voltage: 3.7,
            gps_time: '10:25:34 IST',
            gps_lat: 26.712024,
            gps_lon: 84.304988,
            gps_alt: 54.1,
            gps_sats: 12,
            ax: 0.04,
            ay: -0.09,
            az: 0.03,
            gxs: 0,
            gys: 0,
            gzs: 0,
            flight_status: 0,
            surface_temp: 0,
            smoke: 0,
            carbon_dioxide: 0,
            ammonia: 0,
            pitch: 0,
            roll: 0,
            yaw: 0
        },
        cansat: {
            team_id: 'TEAM_001',
            timestamp: '2025-10-28 22:21:02',
            packet_count: 1,
            altitude: 100,
            pressure: 1000,
            temp: 25,
            voltage: 3.7,
            gnss_time: '10:25:34 IST',
            gnss_latitude: 26.712024,
            gnss_longitude: 84.304988,
            gnss_altitude: 54.1,
            gnss_sats: 12,
            ax: 0.04,
            ay: -0.09,
            az: 0.03,
            gxs: 0,
            gys: 0,
            gzs: 0,
            flight_status: 0,
            methane: 0,
            carbon_monoxide: 0,
            ammonia: 0,
            carbon_dioxide: 0,
            pitch: 0,
            roll: 0,
            yaw: 0
        }
    };
    
    const startTime = performance.now();
    const testRows = 1000; // Test with 1000 rows
    
    // Start CSV logging if not already started
    if (!csvLogging) {
        await startCSVLogging();
    }
    
    // Simulate high-volume data logging
    for (let i = 0; i < testRows; i++) {
        // Update test data with variations
        testData.rocket.packet_no = i + 1;
        testData.rocket.altitude = 100 + Math.sin(i * 0.1) * 50;
        testData.rocket.pressure = 1000 + Math.cos(i * 0.1) * 100;
        testData.rocket.temp = 25 + Math.sin(i * 0.05) * 10;
        testData.rocket.pitch = Math.sin(i * 0.1) * 30;
        testData.rocket.roll = Math.cos(i * 0.1) * 30;
        testData.rocket.yaw = Math.sin(i * 0.05) * 45;
        
        testData.cansat.packet_count = i + 1;
        testData.cansat.altitude = 100 + Math.cos(i * 0.1) * 50;
        testData.cansat.pressure = 1000 + Math.sin(i * 0.1) * 100;
        testData.cansat.temp = 25 + Math.cos(i * 0.05) * 10;
        testData.cansat.pitch = Math.cos(i * 0.1) * 30;
        testData.cansat.roll = Math.sin(i * 0.1) * 30;
        testData.cansat.yaw = Math.cos(i * 0.05) * 45;
        
        // Log both rocket and cansat data
        await logToCSV(testData.rocket, 'rocket');
        await logToCSV(testData.cansat, 'cansat');
        
        // Small delay to prevent blocking
        if (i % 100 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    console.log(`High-volume test completed:`);
    console.log(`- Rows processed: ${testRows * 2} (${testRows} rocket + ${testRows} cansat)`);
    console.log(`- Duration: ${duration.toFixed(2)}ms`);
    console.log(`- Rate: ${((testRows * 2) / (duration / 1000)).toFixed(0)} rows/second`);
    console.log(`- Memory usage: ${csvData.length.toLocaleString()} rows in memory`);
    
    // Validate system
    validateCSVSystem();
    
    return {
        rowsProcessed: testRows * 2,
        duration: duration,
        rate: (testRows * 2) / (duration / 1000),
        memoryUsage: csvData.length
    };
}

/**
 * Stops CSV logging and downloads final file
 */
async function stopCSVLogging() {
    if (!csvLogging) {
        logToConsole('CSV logging is not active', 'warning');
        return;
    }
    
    logToConsole('Stopping CSV logging and preparing download...', 'info');
    csvLogging = false;
    
    // Clear intervals
    if (csvFlushInterval) {
        clearInterval(csvFlushInterval);
        csvFlushInterval = null;
    }
    
    // Store counts for display before clearing
    const totalCount = csvCounters.total;
    const rocketCount = csvCounters.rocket;
    const cansatCount = csvCounters.cansat;
    
    // Create and download CSV file
    try {
        const rows = [];
        rows.push(unifiedCsvHeader.join(','));
        if (csvBufferRocket.length > 0) rows.push(...csvBufferRocket);
        if (csvBufferCansat.length > 0) rows.push(...csvBufferCansat);
        
        if (rows.length > 1) {
            const csvContent = rows.join('\n') + '\n';
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Telemetry_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            logToConsole(`✅ Downloaded Telemetry.csv! (Total: ${totalCount} rows, Rocket: ${rocketCount}, Cansat: ${cansatCount})`, 'success');
        } else {
            logToConsole('⚠️ No data to download.', 'warning');
        }
    } catch (error) {
        logToConsole(`❌ Error downloading CSV: ${error.message}`, 'error');
    }
    
    // Clear data
    csvData = [];
    csvBuffer = [];
    csvRowCount = 0;
    csvDataRocket = [];
    csvDataCansat = [];
    csvBufferRocket = [];
    csvBufferCansat = [];
    csvCounters.rocket = 0;
    csvCounters.cansat = 0;
    csvCounters.total = 0;
    
    // Update status to show final counts before clearing
    updateCSVStatus();
    
    logToConsole(`CSV logging stopped. Total rows logged: ${totalCount} (Rocket: ${rocketCount}, Cansat: ${cansatCount})`, 'info');
}

/**
 * Stops CSV logging with folder permission request
 */
async function stopCSVLoggingWithPermission() {
    // Simplified: just stop CSV logging (flush and close writer)
    await stopCSVLogging();
}

/**
 * Establishes WebSocket connection with the backend server.
 */
function connectWebSocket() {
    console.log("Attempting to set up WebSocket connection...");
    socket = new WebSocket('ws://localhost:8080');

    socket.onopen = () => {
        console.log("WebSocket connection opened.");
        updateConnectionStatus(true);
        logToConsole('Successfully connected to backend server.', 'system');
        sendMessage({ type: 'get_ports' });
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            // console.log("Received message from server: ", message); // Reduce console spam
            switch (message.type) {
                case 'portlist':
                    console.log("Processing portlist message:", message.payload);
                    populatePortSelects(message.payload);
                    break;
                case 'telemetry':
                    const now = Date.now();
                    const source = message.source === 'rocket' ? 'rocket' : 'cansat';
                    const data = message.payload;

                    // Always keep the latest payload
                    telemetryState[source] = data;

                    // Let render loop handle batched UI updates

                    // Charts only when started or in simulation mode
                    if (isStarted || simulationMode) {
                        if (shouldProcess('charts', source, now)) {
                            pushDataToCharts(data, source);
                        }
                    }

                    // CSV logging runs independently of plotting - log EVERY packet
                    if (csvLogging) {
                        logToCSV(data, source);
                    }
                    
                    // Log formatted telemetry to on-screen console
                    try {
                        const formattedData = formatTelemetryForLog(data, source);
                        logToConsole(`[${message.source.toUpperCase()}] ${formattedData}`, 'info');
                        
                        // Update connection status to show data is being received
                        updateConnectionStatus(true);
                    } catch (_) {}
                    break;
                case 'log':
                    console.log("Processing log message:", message.payload);
                    logToConsole(message.payload.message, message.payload.type);
                    
                    // Update button connection state based on log messages
                    if (message.payload.message.includes('Port for rocket')) {
                        const isConnected = message.payload.message.includes('opened successfully');
                        const rocketConnectBtn = document.getElementById('rocket-connect');
                        if (rocketConnectBtn) {
                            rocketConnectBtn.textContent = isConnected ? 'Disconnect' : 'Connect';
                            rocketConnectBtn.classList.toggle('connected', isConnected);
                        }
                    } else if (message.payload.message.includes('Port for cansat')) {
                        const isConnected = message.payload.message.includes('opened successfully');
                        const cansatConnectBtn = document.getElementById('cansat-connect');
                        if (cansatConnectBtn) {
                            cansatConnectBtn.textContent = isConnected ? 'Disconnect' : 'Connect';
                            cansatConnectBtn.classList.toggle('connected', isConnected);
                        }
                    }
                    break;
                default:
                    console.log("Unknown message type:", message.type);
                    break;
            }
        } catch (e) {
            console.error('Failed to process message:', event.data, e);
            logToConsole(`Error processing message from server: ${e.message}`, 'error');
        }
    };

    socket.onclose = (event) => {
        console.log("WebSocket connection closed:", event.code, event.reason);
        updateConnectionStatus(false);
        if (event.code !== 1000) { // 1000 = normal closure
            logToConsole(`WebSocket connection closed unexpectedly (Code: ${event.code}). Retrying in 3 seconds...`, 'error');
            setTimeout(connectWebSocket, 3000);
        } else {
            logToConsole('WebSocket connection closed normally.', 'info');
        }
    };

    socket.onerror = (error) => {
        console.error("WebSocket Error:", error);
        updateConnectionStatus(false);
        logToConsole(`WebSocket Error: Connection failed. Check if server is running on port 8080.`, 'error');
    };
}

/**
 * Adds event listeners to all interactive elements.
 */
function addEventListeners() {
    // Tab switching removed - single scrollable page
    startRenderLoop();

    // Port refresh buttons
    document.getElementById('rocket-refresh').addEventListener('click', () => sendMessage({ type: 'get_ports' }));
    document.getElementById('cansat-refresh').addEventListener('click', () => sendMessage({ type: 'get_ports' }));

    // Port connect buttons
    document.getElementById('rocket-connect').addEventListener('click', () => togglePortConnection('rocket'));
    document.getElementById('cansat-connect').addEventListener('click', () => togglePortConnection('cansat'));

    // Log buttons
    document.getElementById('clear-log-btn').addEventListener('click', clearLog);
    
    // CSV Logging buttons
    document.getElementById('start-csv-btn').addEventListener('click', async () => {
        if (!csvLogging) {
            try {
                await startCSVLogging();
            } catch (error) {
                logToConsole(`Failed to start CSV logging: ${error.message}`, 'error');
            }
        } else {
            logToConsole('CSV logging is already active', 'warning');
        }
    });
    document.getElementById('stop-csv-btn').addEventListener('click', stopCSVLoggingWithPermission);

    // Map buttons
    document.getElementById('set-ground-station-btn').addEventListener('click', setGroundStation);
    document.getElementById('get-location-btn').addEventListener('click', getCurrentLocation);
    
    // START/STOP button for data plotting
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            isStarted = !isStarted;
            
            // Update button appearance using the global function
            if (typeof window.updateStartStopButton === 'function') {
                window.isStarted = isStarted; // Make isStarted globally available
                window.updateStartStopButton();
            }
            
            if (isStarted) {
                logToConsole('🚀 Data plotting started - Charts will update in real-time!', 'system');
                // Ensure CSV logging is running when plotting starts
                if (!csvLogging) {
                    try { await startCSVLogging(); } catch (_) {}
                }
            } else {
                logToConsole('⏹️ Data plotting stopped - Charts are paused.', 'system');
                // Do not auto-stop CSV to allow continuous logging unless user clicks Stop CSV
            }
        });
        
        // Initialize button state on page load
        setTimeout(() => {
            window.isStarted = isStarted;
            if (typeof window.updateStartStopButton === 'function') {
                window.updateStartStopButton();
            }
        }, 100);
    }
    
    // Ready/Stop toggle buttons
    setupReadyStopButton('rocket');
    setupReadyStopButton('cansat');
    
    // Simulation buttons
    document.getElementById('start-simulation-btn').addEventListener('click', toggleSimulationMode);
    document.getElementById('upload-json-btn').addEventListener('click', () => document.getElementById('json-file-input').click());
    document.getElementById('json-file-input').addEventListener('change', handleJsonFileUpload);
    document.getElementById('upload-csv-btn').addEventListener('click', () => document.getElementById('csv-file-input').click());
    document.getElementById('csv-file-input').addEventListener('change', handleCsvFileUpload);
    document.getElementById('play-simulation-btn').addEventListener('click', playSimulation);
    
    // Start render loop
    startRenderLoop();
}

// --- WEBSOCKET MESSAGE HANDLING ---
// Message handling is now done directly in the WebSocket onmessage event

/**
 * Sends a JSON message to the WebSocket server.
 * @param {object} message The message object to send.
 */
function sendMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        console.error(`WebSocket not ready. State: ${socket ? socket.readyState : 'uninitialized'}`);
        logToConsole(`WebSocket not ready. Attempting to reconnect...`, 'error');
        if (!socket || socket.readyState === WebSocket.CLOSED) {
            connectWebSocket();
        }
    }
}

// --- PORT & CONNECTION MANAGEMENT ---

/**
 * Populates both port dropdowns with the list of available serial ports.
 * @param {Array} ports Array of port objects from the server.
 */
function populatePortSelects(ports) {
    const rocketSelect = document.getElementById('rocket-port-select');
    const cansatSelect = document.getElementById('cansat-port-select');
    
    [rocketSelect, cansatSelect].forEach(select => {
        const currentSelection = select.value;
        select.innerHTML = `<option value="" selected disabled>Select ${select.id.includes('rocket') ? 'Rocket' : 'Cansat'} Port</option>`;
        if (ports && ports.length > 0) {
            ports.forEach(port => {
                const option = document.createElement('option');
                option.value = port.path;
                option.textContent = port.path + (port.manufacturer ? ` (${port.manufacturer})` : '');
                select.appendChild(option);
            });
            // Re-select if still available
            if (ports.some(p => p.path === currentSelection)) {
                select.value = currentSelection;
            }
        } else {
            select.innerHTML += '<option disabled>No USB ports found</option>';
        }
    });
}

/**
 * Toggles the connection for a specific device (rocket or cansat).
 * @param {string} deviceType 'rocket' or 'cansat'.
 */
function togglePortConnection(deviceType) {
    const connectBtn = document.getElementById(`${deviceType}-connect`);
    const portSelect = document.getElementById(`${deviceType}-port-select`);
    const baudSelect = document.getElementById(`${deviceType}-baud-select`);
    
    if (connectBtn.classList.contains('connected')) {
        // If already connected, send disconnect message
        sendMessage({ type: 'disconnect_port', payload: { deviceType } });
    } else {
        // If disconnected, send connect message
        const path = portSelect.value;
        const baudRate = baudSelect.value;
        if (!path || !baudRate) {
            logToConsole(`Please select a port and baud rate for the ${deviceType}.`, 'error');
            return;
        }
        sendMessage({ type: 'connect_port', payload: { deviceType, path, baudRate } });
    }
}

/**
 * Updates the main connection status indicator.
 * @param {boolean} isConnected Whether the WebSocket is connected.
 */
function updateConnectionStatus(isConnected) {
    const statusIndicator = document.getElementById('status-indicator');
    const connectionStatus = document.getElementById('connection-status');
    if (isConnected) {
        statusIndicator.style.backgroundColor = '#28a745'; // Green
        connectionStatus.textContent = 'Connected';
    } else {
        statusIndicator.style.backgroundColor = '#dc3545'; // Red
        connectionStatus.textContent = 'Disconnected';
    }
}

// --- TELEMETRY DATA UPDATES ---

/**
 * Main function to update all UI elements based on incoming data.
 * @param {object} data The parsed data object from the server.
 * @param {string} source 'rocket' or 'cansat'.
 */


function initializeUICache() {
    // Header
    uiCache.header.teamId = document.getElementById('header-team-id');
    uiCache.header.missionTime = document.getElementById('header-mission-time');
    uiCache.header.gnssTime = document.getElementById('header-gnss-time');

    // Loop for both sources
    ['rocket', 'cansat'].forEach(source => {
        uiCache[source].packetCount = document.getElementById(`${source}-packet-count`);
        uiCache[source].flightState = document.getElementById(`${source}-flight-state`);
        uiCache[source].altitudeProgress = document.getElementById(`${source}-altitude-progress`);
        uiCache[source].altitude = document.getElementById(`${source}-altitude`);
        uiCache[source].pressureProgress = document.getElementById(`${source}-pressure-progress`);
        uiCache[source].pressure = document.getElementById(`${source}-pressure`);
        uiCache[source].tempProgress = document.getElementById(`${source}-temp-progress`);
        uiCache[source].temp = document.getElementById(`${source}-temp`);
        uiCache[source].voltageProgress = document.getElementById(`${source}-voltage-progress`);
        uiCache[source].voltage = document.getElementById(`${source}-voltage`);
        uiCache[source].axBar = document.getElementById(`${source}-ax-bar`);
        uiCache[source].ayBar = document.getElementById(`${source}-ay-bar`);
        uiCache[source].azBar = document.getElementById(`${source}-az-bar`);
        uiCache[source].model = document.getElementById(`${source}-model`);
        uiCache[source].roll = document.getElementById(`${source}-roll`);
        uiCache[source].pitch = document.getElementById(`${source}-pitch`);
        uiCache[source].yaw = document.getElementById(`${source}-yaw`);
        uiCache[source].gxs = document.getElementById(`${source}-gxs`);
        uiCache[source].gys = document.getElementById(`${source}-gys`);
        uiCache[source].gzs = document.getElementById(`${source}-gzs`);

        // GNSS Data
        uiCache[source].gnssTime = document.getElementById(`${source}-gnss-time`);
        uiCache[source].gnssLat = document.getElementById(`${source}-gnss-lat`);
        uiCache[source].gnssLon = document.getElementById(`${source}-gnss-lon`);
        uiCache[source].gnssAlt = document.getElementById(`${source}-gnss-alt`);
        uiCache[source].gnssSats = document.getElementById(`${source}-gnss-sats`);

        // Gas Sensors
        if (source === 'rocket') {
            uiCache.rocket.smoke = document.getElementById('rocket-smoke');
            uiCache.rocket.surface_temp = document.getElementById('rocket-surface-temp');
            uiCache.rocket.nh3 = document.getElementById('rocket-ammonia');
            uiCache.rocket.co2 = document.getElementById('rocket-carbon-dioxide');
        } else {
            uiCache.cansat.methane = document.getElementById('cansat-methane');
            uiCache.cansat.carbon_monoxide = document.getElementById('cansat-carbon-monoxide');
            uiCache.cansat.ammonia = document.getElementById('cansat-ammonia');
            uiCache.cansat.carbon_dioxide = document.getElementById('cansat-carbon-dioxide');
        }
    });
    console.log("UI Cache Initialized:", uiCache);
}

function updateUI(data, source) {
    if (!data || typeof data !== 'object') {
        console.warn(`Invalid data received for ${source}`);
        return;
    }

    // --- Update Header ---
    // updateData.txt: 0. TEAM_ID, - In the Navbar
    // updateData.txt: 1. MISSION_TIME, - Navbar
    if (source === 'rocket') {
        updateText('header-team-id', data.team_id);
        updateText('header-mission-time', data.mission_time);
    }

    // --- Get correct container based on gui.html structure ---
    const container = source === 'rocket' ? 
        document.querySelector('.rocket-cansat-telemetry .rocket-heading-tele-part:first-child .rocket-telemetry') :
        document.querySelector('.rocket-cansat-telemetry .rocket-heading-tele-part:last-child .rocket-telemetry');
    
    if (!container) {
        console.error(`Could not find container for ${source}`);
        return; // Exit function to prevent error
    }

    // --- Update Packet Count ---
    // updateData.txt: 2. PACKET_NO, Rocket Telemetry
    // updateData.txt: 2. PACKET_NO, Cansat Telemetry
    const packetCount = (source === 'rocket' ? data.packet_no : data.packet_count) || 'N/A';
    const packetCountEl = document.getElementById(`${source}-packet-count`);
    if (packetCountEl) {
        packetCountEl.textContent = `Packet Count: ${packetCount}`;
    }

    // --- Core Telemetry Values ---
    const coreTelemetry = {
        altitude: { max: 5000, key: 'altitude', unit: 'm', progressId: `${source}-altitude-progress`, valueId: `${source}-altitude` },
        pressure: { max: 1100, key: 'pressure', unit: 'Pa', progressId: `${source}-pressure-progress`, valueId: `${source}-pressure` },
        temp: { max: 100, key: 'temp', unit: '°C', progressId: `${source}-temp-progress`, valueId: `${source}-temp` },
        voltage: { max: 5, key: (source === 'rocket' ? 'battery_voltage' : 'voltage'), unit: 'V', progressId: `${source}-voltage-progress`, valueId: `${source}-voltage` }
    };

    Object.values(coreTelemetry).forEach((config) => {
        const value = data[config.key]; // This can be null
        const progressEl = document.getElementById(config.progressId);
        const valueEl = document.getElementById(config.valueId);
        
        if (progressEl) {
            updateCircularProgress(progressEl, value, config.max);
        }
        
        if (valueEl) {
            valueEl.textContent = (value !== null && value !== undefined) ? 
                `${parseFloat(value).toFixed(2)}` : 'N/A';
        }
    });

    // --- Linear Axis Bars ---
    // updateData.txt: 12-14. AX,AY,AZ
    const axisValues = ['ax', 'ay', 'az'].map(key => data[key]); // Gets value or null
    axisValues.forEach((value, index) => {
        const barId = `${source}-${['ax', 'ay', 'az'][index]}-bar`;
        const bar = document.getElementById(barId);
        if (bar) {
            updateLinearAxisBar(bar, value, 16); // Max range of 16g
        }
    });

    // --- Flight State ---
    // updateData.txt: 18. FLIGHTSOFTWARE_STATUS
    const rawFlight = (data.flight_status !== undefined && data.flight_status !== null)
        ? data.flight_status : data.flight_state;
    const flightIdx = (rawFlight !== undefined && rawFlight !== null && !isNaN(parseInt(rawFlight, 10)))
        ? parseInt(rawFlight, 10) : null;
    const flightState = FLIGHT_STATES[flightIdx] || 'N/A'; // Handles null/undefined
    
    // Update flight state in telemetry panel
    const flightStateEl = document.getElementById(`${source}-flight-state`);
    if (flightStateEl) {
        flightStateEl.textContent = `Flight State: ${flightState}`;
        flightStateEl.style.color = flightState === 'N/A' ? '#333' : 
            flightState === 'IMPACT' ? '#ff4444' : '#00aa00';
    }

    // --- Gas Sensor Values ---
    updateGasSensors(container, source, data);

    // --- Orientation & Gyro ---
    updateOrientationDisplay(source, data);
    
    // --- GNSS Data & Map ---
    updateGNSSData(source, data);
    
    // --- Update Charts ---
    if (typeof updateChartData === 'function') {
        updateChartData(data, source);
    }
}

// Old updateRocketTelemetry and updateCansatTelemetry functions removed - replaced by updateUI function

/**
 * Sets up the Ready/Stop toggle functionality for a device.
 * @param {string} deviceType 'rocket' or 'cansat'.
 */
function setupReadyStopButton(deviceType) {
    const button = document.getElementById(`${deviceType}-ready-btn`);
    if (button) {
        let isReady = true; // Track button state
        
        button.addEventListener('click', () => {
            if (isReady) {
                // Send 'R' command and change to STOP
                sendCommand(deviceType, 'R');
                button.textContent = 'STOP';
                button.style.backgroundColor = '#ff4444';
                button.style.color = 'white';
                isReady = false;
            } else {
                // Send 'S' command and change back to READY
                sendCommand(deviceType, 'S');
                button.textContent = 'READY';
                button.style.backgroundColor = '';
                button.style.color = '';
                isReady = true;
            }
        });
    }
}

/**
 * Sends a command to a specific device.
 * @param {string} deviceType 'rocket' or 'cansat'.
 * @param {string} command The command string to send.
 */
function sendCommand(deviceType, command) {
    logToConsole(`Sending command '${command}' to ${deviceType}...`, 'info');
    sendMessage({
        type: 'command',
        payload: {
            deviceType,
            command
        }
    });
}

// --- GUI HELPER FUNCTIONS ---

/**
 * Safely updates the text content of an element.
 * @param {string} id The element ID.
 * @param {string|number} value The value to display.
 * @param {string} [unit=''] An optional unit to append.
 */
function updateText(id, value, unit = '') {
    const el = document.getElementById(id);
    if (el) {
        if (value === null || value === undefined || value === 'N/A') {
            el.textContent = 'N/A';
        } else {
            // Check if value is a number and format it
            const num = parseFloat(value);
            if (!isNaN(num)) {
                let formattedValue;
                // Use more precision for lat/lon
                if (id.includes('-lat') || id.includes('-lon')) {
                    formattedValue = num.toFixed(6);
                } else {
                    formattedValue = num.toFixed(2);
                }
                el.textContent = `${formattedValue} ${unit}`.trim();
            } else {
                // It's a string (like time or flight state)
                el.textContent = `${value} ${unit}`.trim();
            }
        }
    }
}

/**
 * Updates a circular progress bar.
 * @param {HTMLElement} element The .circular-progress element.
 * @param {number | null} value The current value.
 * @param {number} max The maximum value for 100%.
 */
function updateCircularProgress(element, value, max) {
    if (!element) return;
    let percent = 0;
    let displayVal = "N/A";
    
    if (value !== null && value !== undefined && !isNaN(value)) {
        const numValue = parseFloat(value);
        percent = Math.max(0, Math.min(100, (numValue / max) * 100));
        // Use toFixed(0) for cleaner display inside circle
        displayVal = `${numValue.toFixed(0)}`; 
    }
    
    element.style.background = `conic-gradient(#FFC107 ${percent}%, #FFE082 ${percent}%)`;
    const span = element.querySelector('span');
    if (span) span.textContent = displayVal;
}

/**
 * Updates a linear progress bar for axis values.
 * @param {HTMLElement} element The .rocket-axis-values element.
 * @param {number | null} value The current value.
 * @param {number} max The max absolute value (e.g., 16 for 16g).
 */
function updateLinearAxisBar(element, value, max) {
    if (!element) return;
    let percent = 0;
    let displayVal = "N/A";

    if (value !== null && value !== undefined && !isNaN(value)) {
        const numValue = parseFloat(value);
        // Map range [-max, +max] to [0%, 100%]
        percent = Math.max(0, Math.min(100, ((numValue + max) / (2 * max)) * 100));
        displayVal = numValue.toFixed(2);
    }

    element.style.setProperty('--bar-width', `${percent}%`);
    const div = element.querySelector('div');
    if (div) div.textContent = displayVal;
}

/**
 * Updates the flight state bar with color coding.
 * @param {string} barId The element ID of the flight state bar.
 * @param {string} textId The element ID of the flight state text.
 * @param {string} flightState The flight state string.
 */
function updateFlightStateBar(barId, textId, flightState) {
    const barEl = document.getElementById(barId);
    const textEl = document.getElementById(textId);
    
    if (!barEl || !textEl) return;
    
    // Update text
    textEl.textContent = flightState || 'N/A';
    
    // Update color based on flight state
    let color = '#e0e0e0'; // Default gray
    switch (flightState) {
        case 'LAUNCH_PAD':
            color = '#4CAF50'; // Green
            break;
        case 'ASCENT':
            color = '#2196F3'; // Blue
            break;
        case 'DROUGE_DEPLOYED':
            color = '#FF9800'; // Orange
            break;
        case 'DESCENT':
            color = '#9C27B0'; // Purple
            break;
        case 'MAIN_PARA_DEPLOYED':
            color = '#00BCD4'; // Cyan
            break;
        case 'IMPACT':
            color = '#F44336'; // Red
            break;
    }
    
    barEl.style.backgroundColor = color;
}

/**
 * Applies CSS transform to rotate the 3D model images.
 * @param {string} id The element ID of the img.
 * @param {number} roll The roll angle.
 * @param {number} pitch The pitch angle.
 * @param {number} yaw The yaw angle.
 */
function update3DModel(id, roll, pitch, yaw) {
    const el = document.getElementById(id);
    if (el) {
        el.style.transform = `
            rotateX(${parseFloat(pitch) || 0}deg)
            rotateY(${parseFloat(yaw) || 0}deg)
            rotateZ(${parseFloat(roll) || 0}deg)
        `;
    }
}

/**
 * Formats telemetry data for log display in a readable format
 * @param {object} data The telemetry data object
 * @param {string} source 'rocket' or 'cansat'
 * @returns {string} Formatted string for log display
 */
function formatTelemetryForLog(data, source) {
    if (!data || typeof data !== 'object') return 'Invalid data';
    
    const keyFields = source === 'rocket' ? [
        'packet_no', 'altitude', 'pressure', 'temp', 'battery_voltage',
        'gps_lat', 'gps_lon', 'gps_alt', 'ax', 'ay', 'az', 'flight_status'
    ] : [
        'packet_count', 'altitude', 'pressure', 'temp', 'voltage',
        'gnss_latitude', 'gnss_longitude', 'gnss_altitude', 'ax', 'ay', 'az', 'flight_state'
    ];
    
    const formattedFields = keyFields.map(field => {
        const value = data[field];
        if (value === null || value === undefined) return `${field}: N/A`;
        return `${field}: ${value}`;
    });
    
    return formattedFields.join(' | ');
}

/**
 * Logs a message to the on-screen console.
 * @param {string} message The message to log.
 * @param {string} [type='info'] 'info', 'success', 'warning', 'error'.
 */
function logToConsole(message, type = 'info') {
    const logContainer = document.getElementById('log');
    if (!logContainer) return;

    const p = document.createElement('p');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    p.classList.add(`log-${type}`);
    
    logContainer.appendChild(p);
    // Auto-scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Limit log entries to prevent memory issues
    const maxEntries = 1000;
    while (logContainer.children.length > maxEntries) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

/**
 * Clears the on-screen console.
 */
function clearLog() {
    const logContainer = document.getElementById('log');
    if (logContainer) {
        logContainer.innerHTML = '';
        logToConsole('Log cleared.', 'info');
    }
}

/**
 * Updates the gas sensor values in the telemetry panel.
 * @param {HTMLElement} container The parent container for rocket or cansat.
 * @param {string} source 'rocket' or 'cansat'.
 * @param {object} data The data object.
 */
function updateGasSensors(container, source, data) {
    // updateData.txt: 19-22.
    const sensorMap = source === 'rocket' ? {
        'rocket-smoke': 'smoke',
        'rocket-surface-temp': 'surface_temp',
        'rocket-ammonia': 'nh3',
        'rocket-carbon-dioxide': 'co2'
    } : {
        'cansat-methane': 'methane',
        'cansat-carbon-monoxide': 'carbon_monoxide',
        'cansat-ammonia': 'ammonia',
        'cansat-carbon-dioxide': 'carbon_dioxide'
    };

    Object.entries(sensorMap).forEach(([elementId, dataKey]) => {
        const element = document.getElementById(elementId);
        if (element) {
            const value = data[dataKey]; // This can be null
            const label = elementId.split('-').slice(1).join(' ').toUpperCase();
            element.textContent = `${label} : ${(value !== undefined && value !== null) ? parseFloat(value).toFixed(2) : 'N/A'}`;
            element.style.borderLeft = (value !== undefined && value !== null) ? 
                '4px solid #4CAF50' : '4px solid #FFA500';
        }
    });
}

/**
 * Updates the 3D orientation image and text values.
 * @param {string} source 'rocket' or 'cansat'.
 * @param {object} data The data object.
 */
function updateOrientationDisplay(source, data) {
    // updateData.txt: 23-25. PITCH,ROLL,YAW
    // updateData.txt: 15-17. Gxs,Gys,Gzs
    
    // Update 3D orientation image
    const img = document.getElementById(`${source}-model`);
    if (img) {
        updateOrientation(img, data.pitch, data.roll, data.yaw);
    }

    // Update orientation stats (Roll, Pitch, Yaw)
    ['roll', 'pitch', 'yaw'].forEach((axis) => {
        const element = document.getElementById(`${source}-${axis}`);
        if (element) {
            const value = data[axis];
            let displayValue = 'N/A';
            
            if (value !== undefined && value !== null && !isNaN(parseFloat(value))) {
                const numValue = parseFloat(value);
                // Clamp values to reasonable ranges for display
                const clampedValue = Math.max(-180, Math.min(180, numValue));
                displayValue = clampedValue.toFixed(1) + '°';
                
                // Add color coding for extreme values
                if (Math.abs(clampedValue) > 45) {
                    element.style.color = '#ff6b6b'; // Red for extreme values
                } else if (Math.abs(clampedValue) > 15) {
                    element.style.color = '#ffa726'; // Orange for moderate values
                } else {
                    element.style.color = '#4caf50'; // Green for normal values
                }
            } else {
                element.style.color = '#9e9e9e'; // Gray for N/A
            }
            
            element.textContent = `${axis.charAt(0).toUpperCase() + axis.slice(1)}: ${displayValue}`;
        }
    });

    // Debug log for 3D model updates (only in development)
    if (data.pitch !== undefined || data.roll !== undefined || data.yaw !== undefined) {
        if (performanceMonitor.updateCount % 10 === 0) { // Log every 10th update
            console.log(`3D Model Update - ${source}: Pitch=${data.pitch}, Roll=${data.roll}, Yaw=${data.yaw}`);
        }
    }

    // Update gyro values (GXs, GYs, GZs)
    ['gxs', 'gys', 'gzs'].forEach((axis) => {
        const element = document.getElementById(`${source}-${axis}`);
        if (element) {
            const value = data[axis]; // This can be null
            element.textContent = `${axis.toUpperCase()}: ${
                (value !== undefined && value !== null) ? parseFloat(value).toFixed(2) : 'N/A'
            }`;
        }
    });
}

/**
 * Helper function to update 3D model orientation.
 * @param {HTMLElement} element The container element (not used anymore, kept for compatibility).
 * @param {number | null} pitch
 * @param {number | null} roll  
 * @param {number | null} yaw
 */
function updateOrientation(element, pitch, roll, yaw) {
    if (!element) return;
    // Delegate to three.js renderer defined in gui.html
    const id = element.id || '';
    let source = '';
    if (id.includes('rocket')) source = 'rocket';
    else if (id.includes('cansat')) source = 'cansat';
    if (typeof window.update3DOrientation === 'function' && source) {
        // Pass values as-is: calibration happens in gui.html update3DOrientation function
        window.update3DOrientation(source, pitch, roll, yaw);
    }
}

/**
 * Updates all GNSS data fields in the header and map sidebar.
 * @param {string} source 'rocket' or 'cansat'.
 * @param {object} data The data object.
 */
function updateGNSSData(source, data) {
    const isRocket = source === 'rocket';
    
    // Define keys based on source, as per updateData.txt and common convention
    const dataKeys = {
        time: isRocket ? 'gps_time' : 'gnss_time',
        lat: isRocket ? 'gps_lat' : 'gnss_latitude',
        lon: isRocket ? 'gps_lon' : 'gnss_longitude',
        alt: isRocket ? 'gps_alt' : 'gnss_altitude',
        sats: isRocket ? 'gps_sats' : 'gnss_sats'
    };
    
    // Get values, defaulting to null if missing
    const values = {
        time: data[dataKeys.time] || null,
        lat: data[dataKeys.lat] || null,
        lon: data[dataKeys.lon] || null,
        alt: data[dataKeys.alt] || null,
        sats: data[dataKeys.sats] || null
    };

    // 1. Update header GNSS time (use most recent one)
    if (values.time) {
        updateText('header-gnss-time', values.time);
    }
    
    // 2. Update sidebar GNSS data
    const displayPrefix = isRocket ? 'rocket' : 'cansat';
    updateText(`${displayPrefix}-gnss-time`, values.time);
    updateText(`${displayPrefix}-gnss-lat`, values.lat);
    updateText(`${displayPrefix}-gnss-lon`, values.lon);
    updateText(`${displayPrefix}-gnss-alt`, values.alt);
    updateText(`${displayPrefix}-gnss-sats`, values.sats);

    // 3. Update map if coordinates are valid
    if (isValidCoordinate(values.lat, values.lon)) {
        updateMapMarker(source, parseFloat(values.lat), parseFloat(values.lon));
    }
}

function isValidCoordinate(lat, lon) {
    return lat !== null && lon !== null &&
           !isNaN(lat) && !isNaN(lon) &&
           Math.abs(parseFloat(lat)) <= 90 && 
           Math.abs(parseFloat(lon)) <= 180;
}

// --- TAB NAVIGATION ---

// Tab switching functionality removed - using single scrollable page layout

// --- CHARTS ---

/**
 * Smooths data points using moving average for cleaner visualization
 */
function smoothDataPoints(dataPoints, windowSize = 3) {
    if (dataPoints.length < windowSize) return;
    
    const smoothed = [...dataPoints];
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let i = halfWindow; i < dataPoints.length - halfWindow; i++) {
        let sum = 0;
        for (let j = i - halfWindow; j <= i + halfWindow; j++) {
            sum += dataPoints[j].y;
        }
        smoothed[i].y = sum / windowSize;
    }
    
    return smoothed;
}

/**
 * Performance monitoring function
 */
function logPerformanceMetrics() {
    if (performanceMonitor.frameRate > 0) {
        console.log(`Performance: ${performanceMonitor.frameRate} FPS, ${performanceMonitor.updateCount} updates/sec`);
    }
    
    // Memory usage monitoring
    if (performance.memory) {
        const memory = performance.memory;
        const usedMB = Math.round(memory.usedJSHeapSize / 1048576);
        if (usedMB > 50) { // Log if using more than 50MB
            console.log(`Memory: ${usedMB}MB used`);
        }
    }
}

/**
 * Optimized chart initialization for better performance
 */
function initializeCharts() {
    const defaultOptions = (title, shadowColor) => ({
        responsive: true,
        maintainAspectRatio: false,
        // Performance optimizations
        animation: false,
        hover: { animationDuration: 0 },
        responsiveAnimationDuration: 0,
        plugins: {
            title: { display: false },
            legend: { 
                labels: { 
                    color: '#000',
                    font: { weight: 'bold' }
                } 
            }
        },
        scales: {
            x: {
                type: 'linear',
                position: 'bottom',
                title: { 
                    display: true, 
                    text: 'Time (s)', 
                    color: '#000',
                    font: { weight: 'bold' }
                },
                ticks: { 
                    color: '#000',
                    font: { weight: 'bold' },
                    callback: function(value) {
                        return value.toFixed(1) + 's';
                    }
                },
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)'
                },
                min: 0,
                max: 30,
                beginAtZero: true
            },
            y: {
                title: { 
                    display: true, 
                    text: title, 
                    color: '#000',
                    font: { weight: 'bold' }
                },
                ticks: { 
                    color: '#000',
                    font: { weight: 'bold' }
                },
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)'
                }
            }
        }
    });
    
    const createChart = (ctx, title, rocketLabel, cansatLabel, rocketShadowColor, cansatShadowColor) => {
        return new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: rocketLabel,
                        borderColor: '#ff4444',
                        backgroundColor: rocketShadowColor,
                        data: [],
                        fill: true,
                        tension: 0.1,
                        borderWidth: 3,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: cansatLabel,
                        borderColor: '#4444ff',
                        backgroundColor: cansatShadowColor,
                        data: [],
                        fill: true,
                        tension: 0.1,
                        borderWidth: 3,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: defaultOptions(title)
        });
    };
    
    // Different shadow colors for each chart
    charts.altitude = createChart(
        document.getElementById('altitudeChart').getContext('2d'), 
        'Altitude (m)', 
        'Rocket Altitude', 
        'Cansat Altitude',
        'rgba(255, 68, 68, 0.3)',    // Red shadow
        'rgba(68, 68, 255, 0.3)'     // Blue shadow
    );
    
    charts.temperature = createChart(
        document.getElementById('temperatureChart').getContext('2d'), 
        'Temperature (°C)', 
        'Rocket Temp', 
        'Cansat Temp',
        'rgba(255, 165, 0, 0.3)',    // Orange shadow
        'rgba(0, 128, 0, 0.3)'       // Green shadow
    );
    
    charts.pressure = createChart(
        document.getElementById('pressureChart').getContext('2d'), 
        'Pressure (hPa)', 
        'Rocket Pressure', 
        'Cansat Pressure',
        'rgba(128, 0, 128, 0.3)',    // Purple shadow
        'rgba(0, 255, 255, 0.3)'     // Cyan shadow
    );
    
    charts.voltage = createChart(
        document.getElementById('voltageChart').getContext('2d'), 
        'Voltage (V)', 
        'Rocket Voltage', 
        'Cansat Voltage',
        'rgba(255, 20, 147, 0.3)',   // Deep pink shadow
        'rgba(50, 205, 50, 0.3)'     // Lime green shadow
    );

    const gyroOptions = defaultOptions('Gyro (deg/s)');
    gyroOptions.plugins.legend.display = true;
    
    charts.rocketGyro = new Chart(document.getElementById('rocketGyroChart').getContext('2d'), {
        type: 'line',
        data: { datasets: [
            { 
                label: 'GXs', 
                borderColor: '#ff0000', 
                backgroundColor: 'rgba(255, 0, 0, 0.3)',
                data: [], 
                fill: true, 
                tension: 0.1,
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 4
            },
            { 
                label: 'GYs', 
                borderColor: '#00ff00', 
                backgroundColor: 'rgba(0, 255, 0, 0.3)',
                data: [], 
                fill: true, 
                tension: 0.1,
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 4
            },
            { 
                label: 'GZs', 
                borderColor: '#0000ff', 
                backgroundColor: 'rgba(0, 0, 255, 0.3)',
                data: [], 
                fill: true, 
                tension: 0.1,
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 4
            }
        ]},
        options: gyroOptions
    });
    
    charts.cansatGyro = new Chart(document.getElementById('cansatGyroChart').getContext('2d'), {
        type: 'line',
        data: { datasets: [
            { 
                label: 'GXs', 
                borderColor: '#ff0000', 
                backgroundColor: 'rgba(255, 0, 0, 0.3)',
                data: [], 
                fill: true, 
                tension: 0.1,
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 4
            },
            { 
                label: 'GYs', 
                borderColor: '#00ff00', 
                backgroundColor: 'rgba(0, 255, 0, 0.3)',
                data: [], 
                fill: true, 
                tension: 0.1,
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 4
            },
            { 
                label: 'GZs', 
                borderColor: '#0000ff', 
                backgroundColor: 'rgba(0, 0, 255, 0.3)',
                data: [], 
                fill: true, 
                tension: 0.1,
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 4
            }
        ]},
        options: gyroOptions
    });
}

/**
 * Creates a dataset object for a Chart.js chart.
 * @param {string} label The dataset label.
 * @param {Array} data The data array.
 * @param {string} color The line/point color.
 * @returns {object} A Chart.js dataset object.
 */
function createDataset(label, data, color) {
    return {
        label: label,
        data: data,
        borderColor: color,
        backgroundColor: color + '30', // 30% opacity
        borderWidth: 2,
        fill: true,
        tension: 0.2,
        pointRadius: 0
    };
}

/**
 * PUSHES new data to chart arrays without updating/drawing.
 * Uses RTC timestamps from device data for accurate time plotting.
 * @param {object} data The data object.
 * @param {string} source 'rocket' or 'cansat'.
 */
function pushDataToCharts(data, source) {
    const safeNumber = (v) => (v === null || v === undefined || isNaN(parseFloat(v)) ? null : parseFloat(v));
    
    // Initialize time counters if they don't exist
    if (!window.chartTimeCounters) {
        window.chartTimeCounters = {
            rocket: { startTime: null, lastTime: 0, offset: 0 },
            cansat: { startTime: null, lastTime: 0, offset: 0 }
        };
    }
    
    let time = 0;
    let timeSource = 'fallback';
    
    // Try to extract RTC time from device data
    if (source === 'rocket') {
        // Rocket uses mission_time or gps_time
        if (data.mission_time !== undefined && data.mission_time !== null) {
            time = safeNumber(data.mission_time);
            timeSource = 'mission_time';
        } else if (data.gps_time !== undefined && data.gps_time !== null) {
            time = safeNumber(data.gps_time);
            timeSource = 'gps_time';
        }
    } else if (source === 'cansat') {
        // Cansat uses timestamp or gnss_time
        if (data.timestamp !== undefined && data.timestamp !== null) {
            time = safeNumber(data.timestamp);
            timeSource = 'timestamp';
        } else if (data.gnss_time !== undefined && data.gnss_time !== null) {
            time = safeNumber(data.gnss_time);
            timeSource = 'gnss_time';
        }
    }
    
    // If we have a valid RTC time, use it
    if (time !== null && !isNaN(time) && time > 0) {
        const counter = window.chartTimeCounters[source];
        
        // Set start time on first valid data
        if (counter.startTime === null) {
            counter.startTime = time;
            counter.offset = 0;
        }
        
        // Calculate elapsed time since start
        const elapsedTime = time - counter.startTime;
        
        // Ensure time progression (avoid getting stuck on same x value)
        if (elapsedTime > counter.lastTime) {
            counter.lastTime = elapsedTime;
            time = elapsedTime;
        } else {
            // If time didn't progress, increment slightly to avoid stuck plotting
            counter.lastTime += 0.1;
            time = counter.lastTime;
        }
    } else {
        // Fallback to incremental time if no RTC data
        const counter = window.chartTimeCounters[source];
        if (counter.startTime === null) {
            counter.startTime = Date.now() / 1000;
            counter.lastTime = 0;
        }
        counter.lastTime += 0.1; // Increment by 0.1 seconds
        time = counter.lastTime;
        timeSource = 'incremental';
    }

    const addData = (chart, datasetIndex, value) => {
        const y = safeNumber(value);
        if (y !== null && chart && chart.data && chart.data.datasets[datasetIndex]) {
            // Add new data point
            chart.data.datasets[datasetIndex].data.push({ x: time, y });
            
            // Dynamic data management for cleaner plotting
            const dataset = chart.data.datasets[datasetIndex];
            
            // Remove data older than time window
            const cutoffTime = time - CHART_TIME_WINDOW;
            dataset.data = dataset.data.filter(point => point.x >= cutoffTime);
            
            // Smart data reduction for long-term plotting
            if (dataset.data.length > MAX_CHART_POINTS) {
                // Keep every nth point to maintain performance while preserving trends
                const keepEvery = Math.ceil(dataset.data.length / MAX_CHART_POINTS);
                dataset.data = dataset.data.filter((_, index) => index % keepEvery === 0 || index === dataset.data.length - 1);
            }
            
            // Smooth data for cleaner visualization
            if (dataset.data.length > 10) {
                smoothDataPoints(dataset.data, 3); // Apply 3-point smoothing
            }
        }
    };

    const rocketIndex = 0;
    const cansatIndex = 1;

    if (source === 'rocket') {
        addData(charts.altitude, rocketIndex, data.altitude);
        addData(charts.temperature, rocketIndex, data.temp);
        addData(charts.pressure, rocketIndex, data.pressure);
        addData(charts.voltage, rocketIndex, data.battery_voltage);
        
        addData(charts.rocketGyro, 0, data.gxs);
        addData(charts.rocketGyro, 1, data.gys);
        addData(charts.rocketGyro, 2, data.gzs);
        // charts.rocketGyro.update('none'); // <-- REMOVED
        
    } else if (source === 'cansat') {
        addData(charts.altitude, cansatIndex, data.altitude);
        addData(charts.temperature, cansatIndex, data.temp);
        addData(charts.pressure, cansatIndex, data.pressure);
        addData(charts.voltage, cansatIndex, data.voltage);
        
        addData(charts.cansatGyro, 0, data.gxs);
        addData(charts.cansatGyro, 1, data.gys);
        addData(charts.cansatGyro, 2, data.gzs);
        // charts.cansatGyro.update('none'); // <-- REMOVED
    }

    // charts.altitude.update('none');     // <-- REMOVED
    // charts.temperature.update('none');  // <-- REMOVED
    // charts.pressure.update('none');     // <-- REMOVED
    // charts.voltage.update('none');      // <-- REMOVED
}

// --- MAP & DISTANCE ---

/**
 * Initializes the Leaflet map.
 */
function initializeMap() {
    map = L.map('map', {
        center: [26.51, 80.23], // Default center
        zoom: 13,
        maxZoom: 19,
        minZoom: 3
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        crossOrigin: true,
        className: 'map-tiles'
    }).addTo(map);

    const createMarkerIcon = (color) => L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });

    rocketMarker = L.marker([0, 0], { 
        icon: createMarkerIcon('#ff4444'),
        title: 'Rocket'
    }).addTo(map);
    
    cansatMarker = L.marker([0, 0], { 
        icon: createMarkerIcon('#4444ff'),
        title: 'Cansat'
    }).addTo(map);
    
    groundStationMarker = L.marker([0, 0], { 
        draggable: true,
        title: 'Ground Station'
    }).addTo(map);

    groundStationMarker.on('dragend', function(event) {
        groundStationCoords = event.target.getLatLng();
        const groundLatInput = document.getElementById('maps-latitude');
        const groundLonInput = document.getElementById('maps-longitude');
        if (groundLatInput && groundLonInput) {
            groundLatInput.value = groundStationCoords.lat.toFixed(6);
            groundLonInput.value = groundStationCoords.lng.toFixed(6);
        }
        logToConsole(`Ground station position updated: ${groundStationCoords.lat.toFixed(6)}, ${groundStationCoords.lng.toFixed(6)}`, 'system');
        updateDistances();
    });
}

/**
 * Updates a marker's position on the map.
 * @param {string} type 'rocket', 'cansat', or 'ground'.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 */
function updateMapMarker(type, lat, lon) {
    if (!map) return;
    const pos = [lat, lon];
    const marker = type === 'rocket' ? rocketMarker : cansatMarker;
    
    marker.setLatLng(pos);
    
    if (type === 'rocket') {
        lastRocketCoords = { lat, lon };
    } else {
        lastCansatCoords = { lat, lon };
    }
    
    // Pan map to new position smoothly
    if (map && isStarted) {
        map.panTo(pos, { animate: true, duration: 0.5 });
    }
    
    updateDistances();
}

/**
 * Sets the ground station location from the input fields.
 */
function setGroundStation() {
    const lat = parseFloat(document.getElementById('maps-latitude').value);
    const lon = parseFloat(document.getElementById('maps-longitude').value);
    
    if (isValidCoord(lat) && isValidCoord(lon)) {
        lastCoordinates.ground = { lat, lon };
        groundStationCoords = { lat, lon };
        if (groundStationMarker) {
            groundStationMarker.setLatLng([lat, lon]);
        }
        logToConsole(`Ground station set to: ${lat}, ${lon}`, 'success');
        updateDistances();
    } else {
        logToConsole('Invalid ground station coordinates.', 'error');
    }
}

/**
 * Gets the user's current location using browser geolocation API.
 */
function getCurrentLocation() {
    if (!navigator.geolocation) {
        logToConsole('Geolocation is not supported by this browser.', 'error');
        return;
    }
    
    logToConsole('Requesting location permission...', 'info');
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            // Update input fields
            document.getElementById('maps-latitude').value = lat.toFixed(6);
            document.getElementById('maps-longitude').value = lon.toFixed(6);
            
            // Set as ground station
            setGroundStation();
            
            logToConsole(`Location obtained: ${lat.toFixed(6)}, ${lon.toFixed(6)}`, 'success');
        },
        (error) => {
            let errorMessage = 'Unknown error occurred.';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage = 'Location access denied by user.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = 'Location information is unavailable.';
                    break;
                case error.TIMEOUT:
                    errorMessage = 'Location request timed out.';
                    break;
            }
            logToConsole(`Location error: ${errorMessage}`, 'error');
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

/**
 * Checks if a value is a valid coordinate.
 * @param {any} coord The value to check.
 * @returns {boolean}
 */
function isValidCoord(coord) {
    const num = parseFloat(coord);
    return !isNaN(num) && num !== 0; // 0,0 is unlikely
}

/**
 * Toggles simulation mode on/off.
 */
function toggleSimulationMode() {
    simulationMode = !simulationMode;
    const startBtn = document.getElementById('start-simulation-btn');
    const uploadJsonBtn = document.getElementById('upload-json-btn');
    const uploadCsvBtn = document.getElementById('upload-csv-btn');
    const playBtn = document.getElementById('play-simulation-btn');
    
    if (simulationMode) {
        // Stop receiving data from ports
        isStarted = false;
        startBtn.textContent = 'Stop Simulation';
        startBtn.innerHTML = '<i class="fas fa-stop"></i> <span style="position : relative; bottom:2px;">&nbsp;Stop Simulation</span>';
        uploadJsonBtn.style.display = 'inline-block';
        uploadCsvBtn.style.display = 'inline-block';
        playBtn.style.display = 'inline-block';
        logToConsole('Simulation mode enabled. Port data reception stopped.', 'system');
    } else {
        startBtn.textContent = 'Start Simulation';
        startBtn.innerHTML = '<i class="fas fa-play"></i> <span style="position : relative; bottom:2px;">&nbsp;Start Simulation</span>';
        uploadJsonBtn.style.display = 'none';
        uploadCsvBtn.style.display = 'none';
        playBtn.style.display = 'none';
        simulationData = [];
        if (simInterval) {
            clearInterval(simInterval);
            simInterval = null;
        }
        logToConsole('Simulation mode disabled.', 'system');
    }
}

/**
 * Handles JSON file upload for simulation data.
 */
function handleJsonFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const jsonData = JSON.parse(e.target.result);
            simulationData = Array.isArray(jsonData) ? jsonData : [jsonData];
            logToConsole(`Loaded ${simulationData.length} data points from JSON file.`, 'success');
            
            // Enable play button
            document.getElementById('play-simulation-btn').disabled = false;
        } catch (error) {
            logToConsole(`Error parsing JSON file: ${error.message}`, 'error');
        }
    };
    reader.readAsText(file);
}

/**
 * Handles CSV file upload for simulation data.
 */
function handleCsvFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const csvText = e.target.result;
            const parsedData = parseCsvForSimulation(csvText);
            
            if (parsedData.length > 0) {
                simulationData = parsedData;
                logToConsole(`Loaded ${simulationData.length} data points from CSV file.`, 'success');
                
                // Enable play button
                document.getElementById('play-simulation-btn').disabled = false;
            } else {
                logToConsole('No valid data found in CSV file.', 'error');
            }
        } catch (error) {
            logToConsole(`Error parsing CSV file: ${error.message}`, 'error');
        }
    };
    reader.readAsText(file);
}

/**
 * Parses CSV data for simulation mode.
 * Converts CSV rows into telemetry data objects.
 */
function parseCsvForSimulation(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length !== headers.length) continue;
        
        const rowData = {};
        headers.forEach((header, index) => {
            const value = values[index];
            // Convert numeric values
            if (!isNaN(value) && value !== '') {
                rowData[header] = parseFloat(value);
            } else if (value !== '') {
                rowData[header] = value;
            }
        });
        
        // Determine source based on available data
        let source = 'rocket';
        if (rowData.team_id && rowData.team_id.toString().includes('cansat')) {
            source = 'cansat';
        } else if (rowData.timestamp && !rowData.mission_time) {
            source = 'cansat';
        }
        
        rowData.source = source;
        data.push(rowData);
    }
    
    return data;
}

/**
 * Plays the uploaded simulation data.
 */
function playSimulation() {
    if (!simulationData || simulationData.length === 0) {
        logToConsole('No simulation data loaded. Please upload a JSON file first.', 'error');
        return;
    }
    
    let currentIndex = 0;
    const playBtn = document.getElementById('play-simulation-btn');
    
    if (simInterval) {
        // Stop current simulation
        clearInterval(simInterval);
        simInterval = null;
        playBtn.innerHTML = '<i class="fas fa-play-circle"></i> <span style="position : relative; bottom:2px;">&nbsp;PLAY</span>';
        logToConsole('Simulation stopped.', 'system');
        return;
    }
    
    // Start simulation
    playBtn.innerHTML = '<i class="fas fa-pause-circle"></i> <span style="position : relative; bottom:2px;">&nbsp;PAUSE</span>';
    logToConsole('Starting simulation playback...', 'system');
    
    simInterval = setInterval(() => {
        if (currentIndex >= simulationData.length) {
            currentIndex = 0; // Loop back to beginning
        }
        
        const data = simulationData[currentIndex];
        const source = data.source || (currentIndex % 2 === 0 ? 'rocket' : 'cansat');
        
        // Update UI with simulation data
        updateUI(data, source);
        
        currentIndex++;
    }, 1000); // Update every second
}

/**
 * Optimized render loop for smooth offline performance
 */
function startRenderLoop() {
    if (renderLoopRunning) return;
    renderLoopRunning = true;
    
    let lastUIUpdate = 0;
    let lastChartUpdate = 0;
    let last3DUpdate = 0;
    
    // Optimized update intervals for different components
    const UI_UPDATE_INTERVAL = 50; // 20 FPS for UI updates
    const CHART_UPDATE_INTERVAL = 100; // 10 FPS for charts
    const MODEL_UPDATE_INTERVAL = 16; // 60 FPS for 3D models
    
    function optimizedRenderLoop(currentTime) {
        const deltaTime = currentTime - lastFrameTime;
        lastFrameTime = currentTime;
        frameCount++;
        
        // Performance monitoring
        if (currentTime - performanceMonitor.lastCheck >= 1000) {
            performanceMonitor.frameRate = frameCount;
            logPerformanceMetrics();
            performanceMonitor.updateCount = 0;
            frameCount = 0;
            performanceMonitor.lastCheck = currentTime;
        }
        
        if (isStarted || simulationMode) {
            // High-frequency 3D model updates for smooth rotation
            if (currentTime - last3DUpdate >= MODEL_UPDATE_INTERVAL) {
                update3DModels();
                last3DUpdate = currentTime;
            }
            
            // Medium-frequency UI updates
            if (currentTime - lastUIUpdate >= UI_UPDATE_INTERVAL) {
                updateUIFromTelemetryState();
                lastUIUpdate = currentTime;
            }
            
            // Low-frequency chart updates
            if (currentTime - lastChartUpdate >= CHART_UPDATE_INTERVAL) {
                updateChartsOptimized();
                lastChartUpdate = currentTime;
            }
        }
        
        // Continue loop
        renderLoopId = requestAnimationFrame(optimizedRenderLoop);
    }
    
    // Start the optimized loop
    renderLoopId = requestAnimationFrame(optimizedRenderLoop);
}

/**
 * Optimized UI update from telemetry state
 */
function updateUIFromTelemetryState() {
    const now = Date.now();
    if (telemetryState.rocket && shouldProcess('ui', 'rocket', now)) {
        updateUIFromState(telemetryState.rocket, 'rocket');
        performanceMonitor.updateCount++;
    }
    if (telemetryState.cansat && shouldProcess('ui', 'cansat', now)) {
        updateUIFromState(telemetryState.cansat, 'cansat');
        performanceMonitor.updateCount++;
    }
}

/**
 * Optimized chart updates with batching
 */
function updateChartsOptimized() {
    // Batch all chart updates in a single RAF
    requestAnimationFrame(() => {
        updateChartTimeRanges();
        
        // Update charts with optimized settings
        if (charts.altitude) charts.altitude.update('none');
        if (charts.temperature) charts.temperature.update('none');
        if (charts.pressure) charts.pressure.update('none');
        if (charts.voltage) charts.voltage.update('none');
        if (charts.rocketGyro) charts.rocketGyro.update('none');
        if (charts.cansatGyro) charts.cansatGyro.update('none');
    });
}

/**
 * Optimized 3D model updates
 */
function update3DModels() {
    // This will be called by the 3D model animation loop
    // No additional processing needed here
}

/**
 * Main function to update all UI elements from the latest state.
 * (This is your old updateUI function, modified to use the uiCache)
 * @param {object} data The parsed data object from the state.
 * @param {string} source 'rocket' or 'cansat'.
 */
function updateUIFromState(data, source) {
    if (!data || typeof data !== 'object') return;

    const cache = uiCache[source]; // Get the cached elements
    
    // --- Update Header ---
    if (source === 'rocket' && uiCache.header.teamId) {
        uiCache.header.teamId.textContent = data.team_id || 'N/A';
        uiCache.header.missionTime.textContent = data.mission_time || 'N/A';
    }

    // --- Update Packet Count ---
    const packetCount = (source === 'rocket' ? data.packet_no : data.packet_count) || 'N/A';
    if (cache.packetCount) {
        cache.packetCount.textContent = `Packet Count: ${packetCount}`;
    }

    // --- Core Telemetry Values ---
    const coreTelemetry = {
        altitude: { max: 5000, key: 'altitude', progressEl: cache.altitudeProgress, valueEl: cache.altitude },
        pressure: { max: 1100, key: 'pressure', progressEl: cache.pressureProgress, valueEl: cache.pressure },
        temp: { max: 100, key: 'temp', progressEl: cache.tempProgress, valueEl: cache.temp },
        voltage: { max: 5, key: (source === 'rocket' ? 'battery_voltage' : 'voltage'), progressEl: cache.voltageProgress, valueEl: cache.voltage }
    };

    Object.values(coreTelemetry).forEach((config) => {
        const value = data[config.key];
        if (config.progressEl) {
            updateCircularProgress(config.progressEl, value, config.max);
        }
        if (config.valueEl) {
            config.valueEl.textContent = (value !== null && value !== undefined) ? 
                `${parseFloat(value).toFixed(2)}` : 'N/A';
        }
    });
    
    // --- Linear Axis Bars ---
    if (cache.axBar) updateLinearAxisBar(cache.axBar, data['ax'], 16);
    if (cache.ayBar) updateLinearAxisBar(cache.ayBar, data['ay'], 16);
    if (cache.azBar) updateLinearAxisBar(cache.azBar, data['az'], 16);

    // --- Flight State ---
    const rawFlight2 = (data.flight_status !== undefined && data.flight_status !== null)
        ? data.flight_status : data.flight_state;
    const flightIdx2 = (rawFlight2 !== undefined && rawFlight2 !== null && !isNaN(parseInt(rawFlight2, 10)))
        ? parseInt(rawFlight2, 10) : null;
    const flightState = FLIGHT_STATES[flightIdx2] || 'N/A';
    if (cache.flightState) {
        cache.flightState.textContent = `Flight State: ${flightState}`;
        cache.flightState.style.color = flightState === 'N/A' ? '#333' : 
            flightState === 'IMPACT' ? '#ff4444' : '#00aa00';
    }

    // --- Gas Sensor Values ---
    updateGasSensorsFromCache(source, data);

    // --- Orientation & Gyro ---
    updateOrientationDisplayFromCache(source, data);
    
    // --- GNSS Data & Map ---
    updateGNSSDataFromCache(source, data);
}

/**
 * Updates gas sensors using cached elements.
 */
function updateGasSensorsFromCache(source, data) {
    if (source === 'rocket') {
        const sensors = {
            smoke: data.smoke,
            surface_temp: data.surface_temp,
            nh3: data.nh3,
            co2: data.co2
        };
        
        Object.entries(sensors).forEach(([key, value]) => {
            const element = uiCache.rocket[key];
            if (element) {
                const label = key.replace('_', ' ').toUpperCase();
                element.textContent = `${label} : ${(value !== undefined && value !== null) ? parseFloat(value).toFixed(2) : 'N/A'}`;
                element.style.borderLeft = (value !== undefined && value !== null) ? 
                    '4px solid #4CAF50' : '4px solid #FFA500';
            }
        });
    } else {
        const sensors = {
            methane: data.methane,
            carbon_monoxide: data.carbon_monoxide,
            ammonia: data.ammonia,
            carbon_dioxide: data.carbon_dioxide
        };
        
        Object.entries(sensors).forEach(([key, value]) => {
            const element = uiCache.cansat[key];
            if (element) {
                const label = key.replace('_', ' ').toUpperCase();
                element.textContent = `${label} : ${(value !== undefined && value !== null) ? parseFloat(value).toFixed(2) : 'N/A'}`;
                element.style.borderLeft = (value !== undefined && value !== null) ? 
                    '4px solid #4CAF50' : '4px solid #FFA500';
            }
        });
    }
}

/**
 * Updates orientation display using cached elements.
 */
function updateOrientationDisplayFromCache(source, data) {
    const cache = uiCache[source];
    
    // Update 3D orientation image
    if (cache.model) {
        updateOrientation(cache.model, data.pitch, data.roll, data.yaw);
    }

    // Update orientation stats (Roll, Pitch, Yaw) with enhanced formatting
    ['roll', 'pitch', 'yaw'].forEach((axis) => {
        const element = cache[axis];
        if (element) {
            const value = data[axis];
            let displayValue = 'N/A';
            
            if (value !== undefined && value !== null && !isNaN(parseFloat(value))) {
                const numValue = parseFloat(value);
                // Clamp values to reasonable ranges for display
                const clampedValue = Math.max(-180, Math.min(180, numValue));
                displayValue = clampedValue.toFixed(1) + '°';
                
                // Add color coding for extreme values
                if (Math.abs(clampedValue) > 45) {
                    element.style.color = '#ff6b6b'; // Red for extreme values
                } else if (Math.abs(clampedValue) > 15) {
                    element.style.color = '#ffa726'; // Orange for moderate values
                } else {
                    element.style.color = '#4caf50'; // Green for normal values
                }
            } else {
                element.style.color = '#9e9e9e'; // Gray for N/A
            }
            
            element.textContent = `${axis.charAt(0).toUpperCase() + axis.slice(1)}: ${displayValue}`;
        }
    });

    // Update gyro values (GXs, GYs, GZs)
    ['gxs', 'gys', 'gzs'].forEach((axis) => {
        const element = cache[axis];
        if (element) {
            const value = data[axis];
            element.textContent = `${axis.toUpperCase()}: ${
                (value !== undefined && value !== null) ? parseFloat(value).toFixed(2) : 'N/A'
            }`;
        }
    });
}

/**
 * Updates GNSS data using cached elements.
 */
function updateGNSSDataFromCache(source, data) {
    const isRocket = source === 'rocket';
    const cache = uiCache[source];
    
    // Define keys based on source
    const dataKeys = {
        time: isRocket ? 'gps_time' : 'gnss_time',
        lat: isRocket ? 'gps_lat' : 'gnss_latitude',
        lon: isRocket ? 'gps_lon' : 'gnss_longitude',
        alt: isRocket ? 'gps_alt' : 'gnss_altitude',
        sats: isRocket ? 'gps_sats' : 'gnss_sats'
    };
    
    // Get values
    const values = {
        time: data[dataKeys.time] || null,
        lat: data[dataKeys.lat] || null,
        lon: data[dataKeys.lon] || null,
        alt: data[dataKeys.alt] || null,
        sats: data[dataKeys.sats] || null
    };

    // Update header GNSS time (use most recent one)
    if (values.time && uiCache.header.gnssTime) {
        uiCache.header.gnssTime.textContent = values.time;
    }
    
    // Update sidebar GNSS data
    if (cache.gnssTime) cache.gnssTime.textContent = values.time || 'N/A';
    if (cache.gnssLat) cache.gnssLat.textContent = values.lat || 'N/A';
    if (cache.gnssLon) cache.gnssLon.textContent = values.lon || 'N/A';
    if (cache.gnssAlt) cache.gnssAlt.textContent = values.alt || 'N/A';
    if (cache.gnssSats) cache.gnssSats.textContent = values.sats || 'N/A';

    // Update map if coordinates are valid
    if (isValidCoordinate(values.lat, values.lon)) {
        updateMapMarker(source, parseFloat(values.lat), parseFloat(values.lon));
    }
}

/**
 * Updates the distance readouts between devices.
 */
function updateDistances() {
    // Update distance displays in the map controls
    const distCansatRocket = document.getElementById('dist-cansat-rocket');
    const distCansatGround = document.getElementById('dist-cansat-ground');
    const distRocketGround = document.getElementById('dist-rocket-ground');
    
    if (distCansatRocket) {
        distCansatRocket.textContent = `Cansat <--> Rocket : ${haversineDistance(lastCansatCoords, lastRocketCoords)} m`;
    }
    if (distCansatGround) {
        distCansatGround.textContent = `Cansat <--> Ground : ${haversineDistance(lastCansatCoords, groundStationCoords)} m`;
    }
    if (distRocketGround) {
        distRocketGround.textContent = `Rocket <--> Ground : ${haversineDistance(lastRocketCoords, groundStationCoords)} m`;
    }
}

/**
 * Updates the time axis ranges for all charts to maintain live 30-second window
 */
function updateChartTimeRanges() {
    if (!window.chartTimeCounters) return;
    
    // Get the latest time from any active source
    const rocketTime = window.chartTimeCounters.rocket.lastTime || 0;
    const cansatTime = window.chartTimeCounters.cansat.lastTime || 0;
    const currentTime = Math.max(rocketTime, cansatTime);
    
    if (currentTime > 0) {
        const minTime = Math.max(0, currentTime - CHART_TIME_WINDOW);
        const maxTime = currentTime;
        
        // Update all chart x-axis ranges
        Object.values(charts).forEach(chart => {
            if (chart && chart.options && chart.options.scales && chart.options.scales.x) {
                chart.options.scales.x.min = minTime;
                chart.options.scales.x.max = maxTime;
            }
        });
    }
}

/**
 * Calculates the Haversine distance between two lat/lon points.
 * @param {object} p1 { lat, lon }
 * @param {object} p2 { lat, lon }
 * @returns {string} Distance in meters or 'N/A'.
 */
function haversineDistance(coords1, coords2) {
    if (!coords1 || !coords2) return 'N/A';
    try {
        const R = 6371e3; // metres
        const φ1 = coords1.lat * Math.PI / 180;
        const φ2 = coords2.lat * Math.PI / 180;
        const Δφ = (coords2.lat - coords1.lat) * Math.PI / 180;
        const Δλ = (coords2.lon - coords1.lon) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        const distance = R * c;
        return distance.toFixed(2); // in metres
    } catch (e) {
        console.error("Error in haversineDistance:", e, coords1, coords2);
        return 'N/A';
    }
}

/**
 * Sets the ground station location from the input fields.
 */
function setGroundStation() {
    const lat = parseFloat(document.getElementById('maps-latitude').value);
    const lon = parseFloat(document.getElementById('maps-longitude').value);
    if (!isNaN(lat) && !isNaN(lon)) {
        groundStationCoords = { lat, lon };
        groundStationMarker.setLatLng(groundStationCoords);
        logToConsole(`Ground station set to: ${lat}, ${lon}`, 'system');
        updateDistances();
    } else {
        logToConsole('Invalid coordinates for ground station.', 'error');
    }
}

/**
 * Checks if a value is a valid coordinate.
 * @param {any} coord The value to check.
 * @returns {boolean}
 */
function isValidCoord(coord) {
    const num = parseFloat(coord);
    return !isNaN(num) && num !== 0; // 0,0 is unlikely
}

/**
 * Toggles simulation mode on/off.
 */
function toggleSimulationMode() {
    simulationMode = !simulationMode;
    const startBtn = document.getElementById('start-simulation-btn');
    const uploadJsonBtn = document.getElementById('upload-json-btn');
    const uploadCsvBtn = document.getElementById('upload-csv-btn');
    const playBtn = document.getElementById('play-simulation-btn');
    
    if (simulationMode) {
        // Stop receiving data from ports
        isStarted = false;
        startBtn.textContent = 'Stop Simulation';
        startBtn.innerHTML = '<i class="fas fa-stop"></i> <span style="position : relative; bottom:2px;">&nbsp;Stop Simulation</span>';
        uploadJsonBtn.style.display = 'inline-block';
        uploadCsvBtn.style.display = 'inline-block';
        playBtn.style.display = 'inline-block';
        logToConsole('Simulation mode enabled. Port data reception stopped.', 'system');
    } else {
        startBtn.textContent = 'Start Simulation';
        startBtn.innerHTML = '<i class="fas fa-play"></i> <span style="position : relative; bottom:2px;">&nbsp;Start Simulation</span>';
        uploadJsonBtn.style.display = 'none';
        uploadCsvBtn.style.display = 'none';
        playBtn.style.display = 'none';
        simulationData = [];
        if (simInterval) {
            clearInterval(simInterval);
            simInterval = null;
        }
        logToConsole('Simulation mode disabled.', 'system');
    }
}

/**
 * Handles JSON file upload for simulation data.
 */
function handleJsonFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const jsonData = JSON.parse(e.target.result);
            simulationData = Array.isArray(jsonData) ? jsonData : [jsonData];
            logToConsole(`Loaded ${simulationData.length} data points from JSON file.`, 'success');
            
            // Enable play button
            document.getElementById('play-simulation-btn').disabled = false;
        } catch (error) {
            logToConsole(`Error parsing JSON file: ${error.message}`, 'error');
        }
    };
    reader.readAsText(file);
}

/**
 * Handles CSV file upload for simulation data.
 */
function handleCsvFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const csvText = e.target.result;
            const parsedData = parseCsvForSimulation(csvText);
            
            if (parsedData.length > 0) {
                simulationData = parsedData;
                logToConsole(`Loaded ${simulationData.length} data points from CSV file.`, 'success');
                
                // Enable play button
                document.getElementById('play-simulation-btn').disabled = false;
            } else {
                logToConsole('No valid data found in CSV file.', 'error');
            }
        } catch (error) {
            logToConsole(`Error parsing CSV file: ${error.message}`, 'error');
        }
    };
    reader.readAsText(file);
}

/**
 * Parses CSV data for simulation mode.
 * Converts CSV rows into telemetry data objects.
 */
function parseCsvForSimulation(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length !== headers.length) continue;
        
        const rowData = {};
        headers.forEach((header, index) => {
            const value = values[index];
            // Convert numeric values
            if (!isNaN(value) && value !== '') {
                rowData[header] = parseFloat(value);
            } else if (value !== '') {
                rowData[header] = value;
            }
        });
        
        // Determine source based on available data
        let source = 'rocket';
        if (rowData.team_id && rowData.team_id.toString().includes('cansat')) {
            source = 'cansat';
        } else if (rowData.timestamp && !rowData.mission_time) {
            source = 'cansat';
        }
        
        rowData.source = source;
        data.push(rowData);
    }
    
    return data;
}

/**
 * Plays the uploaded simulation data.
 */
function playSimulation() {
    if (!simulationData || simulationData.length === 0) {
        logToConsole('No simulation data loaded. Please upload a JSON file first.', 'error');
        return;
    }
    
    let currentIndex = 0;
    const playBtn = document.getElementById('play-simulation-btn');
    
    if (simInterval) {
        // Stop current simulation
        clearInterval(simInterval);
        simInterval = null;
        playBtn.innerHTML = '<i class="fas fa-play-circle"></i> <span style="position : relative; bottom:2px;">&nbsp;PLAY</span>';
        logToConsole('Simulation stopped.', 'system');
        return;
    }
    
    // Start simulation
    playBtn.innerHTML = '<i class="fas fa-pause-circle"></i> <span style="position : relative; bottom:2px;">&nbsp;PAUSE</span>';
    logToConsole('Starting simulation playback...', 'system');
    
    simInterval = setInterval(() => {
        if (currentIndex >= simulationData.length) {
            currentIndex = 0; // Loop back to beginning
        }
        
        const data = simulationData[currentIndex];
        const source = data.source || (currentIndex % 2 === 0 ? 'rocket' : 'cansat');
        
        // Update UI with simulation data
        updateUI(data, source);
        
        currentIndex++;
    }, 1000); // Update every second
}

/**
 * Optimized render loop for smooth offline performance
 */
function startRenderLoop() {
    if (renderLoopRunning) return;
    renderLoopRunning = true;
    
    let lastUIUpdate = 0;
    let lastChartUpdate = 0;
    let last3DUpdate = 0;
    
    // Optimized update intervals for different components
    const UI_UPDATE_INTERVAL = 50; // 20 FPS for UI updates
    const CHART_UPDATE_INTERVAL = 100; // 10 FPS for charts
    const MODEL_UPDATE_INTERVAL = 16; // 60 FPS for 3D models
    
    function optimizedRenderLoop(currentTime) {
        const deltaTime = currentTime - lastFrameTime;
        lastFrameTime = currentTime;
        frameCount++;
        
        // Performance monitoring
        if (currentTime - performanceMonitor.lastCheck >= 1000) {
            performanceMonitor.frameRate = frameCount;
            logPerformanceMetrics();
            performanceMonitor.updateCount = 0;
            frameCount = 0;
            performanceMonitor.lastCheck = currentTime;
        }
        
        if (isStarted || simulationMode) {
            // High-frequency 3D model updates for smooth rotation
            if (currentTime - last3DUpdate >= MODEL_UPDATE_INTERVAL) {
                update3DModels();
                last3DUpdate = currentTime;
            }
            
            // Medium-frequency UI updates
            if (currentTime - lastUIUpdate >= UI_UPDATE_INTERVAL) {
                updateUIFromTelemetryState();
                lastUIUpdate = currentTime;
            }
            
            // Low-frequency chart updates
            if (currentTime - lastChartUpdate >= CHART_UPDATE_INTERVAL) {
                updateChartsOptimized();
                lastChartUpdate = currentTime;
            }
        }
        
        // Continue loop
        renderLoopId = requestAnimationFrame(optimizedRenderLoop);
    }
    
    // Start the optimized loop
    renderLoopId = requestAnimationFrame(optimizedRenderLoop);
}

/**
 * Optimized UI update from telemetry state
 */
function updateUIFromTelemetryState() {
    if (telemetryState.rocket) {
        updateUIFromState(telemetryState.rocket, 'rocket');
        // Never set to null - render loop should always show latest data
        performanceMonitor.updateCount++;
    }
    if (telemetryState.cansat) {
        updateUIFromState(telemetryState.cansat, 'cansat');
        // Never set to null - render loop should always show latest data
        performanceMonitor.updateCount++;
    }
}

/**
 * Optimized chart updates with batching
 */
function updateChartsOptimized() {
    // Batch all chart updates in a single RAF
    requestAnimationFrame(() => {
        updateChartTimeRanges();
        
        // Update charts with optimized settings
        if (charts.altitude) charts.altitude.update('none');
        if (charts.temperature) charts.temperature.update('none');
        if (charts.pressure) charts.pressure.update('none');
        if (charts.voltage) charts.voltage.update('none');
        if (charts.rocketGyro) charts.rocketGyro.update('none');
        if (charts.cansatGyro) charts.cansatGyro.update('none');
    });
}

/**
 * Optimized 3D model updates
 */
function update3DModels() {
    // This will be called by the 3D model animation loop
    // No additional processing needed here
}

/**
 * Main function to update all UI elements from the latest state.
 * (This is your old updateUI function, modified to use the uiCache)
 * @param {object} data The parsed data object from the state.
 * @param {string} source 'rocket' or 'cansat'.
 */
function updateUIFromState(data, source) {
    if (!data || typeof data !== 'object') return;

    const cache = uiCache[source]; // Get the cached elements
    
    // --- Update Header ---
    if (source === 'rocket' && uiCache.header.teamId) {
        uiCache.header.teamId.textContent = data.team_id || 'N/A';
        uiCache.header.missionTime.textContent = data.mission_time || 'N/A';
    }

    // --- Update Packet Count ---
    const packetCount = (source === 'rocket' ? data.packet_no : data.packet_count) || 'N/A';
    if (cache.packetCount) {
        cache.packetCount.textContent = `Packet Count: ${packetCount}`;
    }

    // --- Core Telemetry Values ---
    const coreTelemetry = {
        altitude: { max: 5000, key: 'altitude', progressEl: cache.altitudeProgress, valueEl: cache.altitude },
        pressure: { max: 1100, key: 'pressure', progressEl: cache.pressureProgress, valueEl: cache.pressure },
        temp: { max: 100, key: 'temp', progressEl: cache.tempProgress, valueEl: cache.temp },
        voltage: { max: 5, key: (source === 'rocket' ? 'battery_voltage' : 'voltage'), progressEl: cache.voltageProgress, valueEl: cache.voltage }
    };

    Object.values(coreTelemetry).forEach((config) => {
        const value = data[config.key];
        if (config.progressEl) {
            updateCircularProgress(config.progressEl, value, config.max);
        }
        if (config.valueEl) {
            config.valueEl.textContent = (value !== null && value !== undefined) ? 
                `${parseFloat(value).toFixed(2)}` : 'N/A';
        }
    });
    
    // --- Linear Axis Bars ---
    if (cache.axBar) updateLinearAxisBar(cache.axBar, data['ax'], 16);
    if (cache.ayBar) updateLinearAxisBar(cache.ayBar, data['ay'], 16);
    if (cache.azBar) updateLinearAxisBar(cache.azBar, data['az'], 16);

    // --- Flight State ---
    const rawFlight3 = (data.flight_status !== undefined && data.flight_status !== null)
        ? data.flight_status : data.flight_state;
    const flightIdx3 = (rawFlight3 !== undefined && rawFlight3 !== null && !isNaN(parseInt(rawFlight3, 10)))
        ? parseInt(rawFlight3, 10) : null;
    const flightState = FLIGHT_STATES[flightIdx3] || 'N/A';
    if (cache.flightState) {
        cache.flightState.textContent = `Flight State: ${flightState}`;
        cache.flightState.style.color = flightState === 'N/A' ? '#333' : 
            flightState === 'IMPACT' ? '#ff4444' : '#00aa00';
    }

    // --- Gas Sensor Values ---
    updateGasSensorsFromCache(source, data);

    // --- Orientation & Gyro ---
    updateOrientationDisplayFromCache(source, data);
    
    // --- GNSS Data & Map ---
    updateGNSSDataFromCache(source, data);
}

/**
 * Updates gas sensors using cached elements.
 */
function updateGasSensorsFromCache(source, data) {
    if (source === 'rocket') {
        const sensors = {
            smoke: data.smoke,
            surface_temp: data.surface_temp,
            nh3: data.nh3,
            co2: data.co2
        };
        
        Object.entries(sensors).forEach(([key, value]) => {
            const element = uiCache.rocket[key];
            if (element) {
                const label = key.replace('_', ' ').toUpperCase();
                element.textContent = `${label} : ${(value !== undefined && value !== null) ? parseFloat(value).toFixed(2) : 'N/A'}`;
                element.style.borderLeft = (value !== undefined && value !== null) ? 
                    '4px solid #4CAF50' : '4px solid #FFA500';
            }
        });
    } else {
        const sensors = {
            methane: data.methane,
            carbon_monoxide: data.carbon_monoxide,
            ammonia: data.ammonia,
            carbon_dioxide: data.carbon_dioxide
        };
        
        Object.entries(sensors).forEach(([key, value]) => {
            const element = uiCache.cansat[key];
            if (element) {
                const label = key.replace('_', ' ').toUpperCase();
                element.textContent = `${label} : ${(value !== undefined && value !== null) ? parseFloat(value).toFixed(2) : 'N/A'}`;
                element.style.borderLeft = (value !== undefined && value !== null) ? 
                    '4px solid #4CAF50' : '4px solid #FFA500';
            }
        });
    }
}

/**
 * Updates orientation display using cached elements.
 */
function updateOrientationDisplayFromCache(source, data) {
    const cache = uiCache[source];
    
    // Update 3D orientation image
    if (cache.model) {
        updateOrientation(cache.model, data.pitch, data.roll, data.yaw);
    }

    // Update orientation stats (Roll, Pitch, Yaw) with enhanced formatting
    ['roll', 'pitch', 'yaw'].forEach((axis) => {
        const element = cache[axis];
        if (element) {
            const value = data[axis];
            let displayValue = 'N/A';
            
            if (value !== undefined && value !== null && !isNaN(parseFloat(value))) {
                const numValue = parseFloat(value);
                // Clamp values to reasonable ranges for display
                const clampedValue = Math.max(-180, Math.min(180, numValue));
                displayValue = clampedValue.toFixed(1) + '°';
                
                // Add color coding for extreme values
                if (Math.abs(clampedValue) > 45) {
                    element.style.color = '#ff6b6b'; // Red for extreme values
                } else if (Math.abs(clampedValue) > 15) {
                    element.style.color = '#ffa726'; // Orange for moderate values
                } else {
                    element.style.color = '#4caf50'; // Green for normal values
                }
            } else {
                element.style.color = '#9e9e9e'; // Gray for N/A
            }
            
            element.textContent = `${axis.charAt(0).toUpperCase() + axis.slice(1)}: ${displayValue}`;
        }
    });

    // Update gyro values (GXs, GYs, GZs)
    ['gxs', 'gys', 'gzs'].forEach((axis) => {
        const element = cache[axis];
        if (element) {
            const value = data[axis];
            element.textContent = `${axis.toUpperCase()}: ${
                (value !== undefined && value !== null) ? parseFloat(value).toFixed(2) : 'N/A'
            }`;
        }
    });
}

/**
 * Updates GNSS data using cached elements.
 */
function updateGNSSDataFromCache(source, data) {
    const isRocket = source === 'rocket';
    const cache = uiCache[source];
    
    // Define keys based on source
    const dataKeys = {
        time: isRocket ? 'gps_time' : 'gnss_time',
        lat: isRocket ? 'gps_lat' : 'gnss_latitude',
        lon: isRocket ? 'gps_lon' : 'gnss_longitude',
        alt: isRocket ? 'gps_alt' : 'gnss_altitude',
        sats: isRocket ? 'gps_sats' : 'gnss_sats'
    };
    
    // Get values
    const values = {
        time: data[dataKeys.time] || null,
        lat: data[dataKeys.lat] || null,
        lon: data[dataKeys.lon] || null,
        alt: data[dataKeys.alt] || null,
        sats: data[dataKeys.sats] || null
    };

    // Update header GNSS time (use most recent one)
    if (values.time && uiCache.header.gnssTime) {
        uiCache.header.gnssTime.textContent = values.time;
    }
    
    // Update sidebar GNSS data
    if (cache.gnssTime) cache.gnssTime.textContent = values.time || 'N/A';
    if (cache.gnssLat) cache.gnssLat.textContent = values.lat || 'N/A';
    if (cache.gnssLon) cache.gnssLon.textContent = values.lon || 'N/A';
    if (cache.gnssAlt) cache.gnssAlt.textContent = values.alt || 'N/A';
    if (cache.gnssSats) cache.gnssSats.textContent = values.sats || 'N/A';

    // Update map if coordinates are valid
    if (isValidCoordinate(values.lat, values.lon)) {
        updateMapMarker(source, parseFloat(values.lat), parseFloat(values.lon));
    }
}
