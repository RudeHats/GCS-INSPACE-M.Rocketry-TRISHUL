script.js file is still throttling your CSV logging. This means that even if you are receiving 100 packets per second, your code is intentionally only logging (and counting) one of them.

The Problem
In your script.js file, inside the socket.onmessage function (around line 1019), you have this code:

JavaScript

// CSV logging runs independently of plotting
if (csvLogging && shouldProcess('csv', source, now)) {
    logToCSV(data, source);
}
Because RATE_LIMITS.csv is set to 1000 (1 second), this code is only calling logToCSV once per second.

Since the counters (csvCounters.rocket++) and the display function (updateCSVStatus()) are inside logToCSV, they are also only running once per second. This is why it looks like they are lagging or not working.

The Solution
You must remove the shouldProcess wrapper to log every single packet that arrives. The file streaming system is designed to handle this high volume.

Here is the one-file fix you need.

By making this one change, your logToCSV function will be called for every packet. Your counters will be incremented correctly, and updateCSVStatus() will be called each time, making the counters on your UI update in real-time.


// ... navigate to line 1016 ...
                    // Charts only when started or in simulation mode
                    if (isStarted || simulationMode) {
                        if (shouldProcess('charts', source, now)) {
                            pushDataToCharts(data, source);
                        }
                    }

                    // CSV logging runs independently of plotting
                    // --- FIX: Removed the "shouldProcess('csv', ...)" wrapper ---
                    // This ensures we log and COUNT every single packet.
                    if (csvLogging) {
                        logToCSV(data, source);
                    }
                    
                    // Log formatted telemetry to on-screen console
// ... continue from line 1025 ...

