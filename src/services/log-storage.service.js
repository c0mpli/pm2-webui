const fs = require('fs');
const path = require('path');

class LogStorageService {
  constructor() {
    this.logsDir = path.join(process.cwd(), 'logs-storage');
    this.ensureLogsDirectory();
    this.startCleanupInterval();
  }

  ensureLogsDirectory() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  getLogFilePath(appName, logType) {
    // Use single file per app/logType combination
    return path.join(this.logsDir, `${appName}_${logType}.jsonl`);
  }

  async storeLog(appName, logType, logData) {
    try {
      const timestamp = new Date();
      const logEntry = {
        timestamp: timestamp.toISOString(),
        appName,
        logType,
        raw: logData.raw || logData.data,
        parsed: {
          level: logData.level || 'info',
          message: logData.message || logData.action || '',
          jsonData: logData.jsonData || null
        }
      };

      const logFile = this.getLogFilePath(appName, logType);
      const logLine = JSON.stringify(logEntry) + '\n';
      
      await fs.promises.appendFile(logFile, logLine, 'utf8');
    } catch (error) {
      console.error('Error storing log:', error);
    }
  }

  async searchLogs(appName, searchQuery, options = {}) {
    const {
      logType = null, // 'stdout' or 'stderr' or null for both
      hours = 0.5, // 30 minutes default
      limit = 100
    } = options;

    const results = [];
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    try {
      // Get all relevant log files within the time range
      const logFiles = await this.getLogFilesInRange(appName, logType, cutoffTime);
      
      for (const filePath of logFiles) {
        if (results.length >= limit) break;
        
        const fileContent = await fs.promises.readFile(filePath, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (results.length >= limit) break;
          
          try {
            const logEntry = JSON.parse(line);
            
            // Check if log is within time range
            if (new Date(logEntry.timestamp) < cutoffTime) continue;
            
            // Perform search in raw log data
            if (this.matchesSearch(logEntry, searchQuery)) {
              results.push(logEntry);
            }
          } catch (parseError) {
            // Skip malformed lines
            continue;
          }
        }
      }
      
      // Sort by timestamp (newest first)
      results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return results;
    } catch (error) {
      console.error('Error searching logs:', error);
      return [];
    }
  }

  matchesSearch(logEntry, searchQuery) {
    if (!searchQuery || !searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase();
    
    // Search in raw log data
    if (logEntry.raw && logEntry.raw.toLowerCase().includes(query)) {
      return true;
    }
    
    // Search in parsed message
    if (logEntry.parsed.message && logEntry.parsed.message.toLowerCase().includes(query)) {
      return true;
    }
    
    // Search in JSON data if available
    if (logEntry.parsed.jsonData) {
      const jsonStr = JSON.stringify(logEntry.parsed.jsonData).toLowerCase();
      if (jsonStr.includes(query)) {
        return true;
      }
    }
    
    return false;
  }

  async getLogFilesInRange(appName, logType, cutoffTime) {
    const files = [];
    
    try {
      if (logType) {
        // Get specific logType file
        const filePath = this.getLogFilePath(appName, logType);
        if (fs.existsSync(filePath)) {
          files.push(filePath);
        }
      } else {
        // Get both stdout and stderr files
        const stdoutFile = this.getLogFilePath(appName, 'stdout');
        const stderrFile = this.getLogFilePath(appName, 'stderr');
        
        if (fs.existsSync(stdoutFile)) {
          files.push(stdoutFile);
        }
        if (fs.existsSync(stderrFile)) {
          files.push(stderrFile);
        }
      }
    } catch (error) {
      console.error('Error reading log files:', error);
    }
    
    return files;
  }

  async getRecentLogs(appName, logType, options = {}) {
    const { hours = 0.5, limit = 50 } = options; // 30 minutes default
    return this.searchLogs(appName, '', { logType, hours, limit });
  }

  startCleanupInterval() {
    // Clear and rewrite log files every 30 minutes
    setInterval(() => {
      this.clearOldLogs();
    }, 30 * 60 * 1000); // 30 minutes

    // Also run cleanup on startup (after 5 seconds)
    setTimeout(() => {
      this.clearOldLogs();
    }, 5000);
  }

  async clearOldLogs() {
    try {
      console.log('🧹 Clearing log files every 30 minutes...');
      const dirFiles = await fs.promises.readdir(this.logsDir);
      
      for (const file of dirFiles) {
        if (file.endsWith('.jsonl')) {
          const filePath = path.join(this.logsDir, file);
          
          // Clear the file contents (but keep the file)
          await fs.promises.writeFile(filePath, '', 'utf8');
          console.log(`Cleared log file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Error clearing log files:', error);
    }
  }

  async getStorageStats() {
    try {
      const files = await fs.promises.readdir(this.logsDir);
      const logFiles = files.filter(f => f.endsWith('.jsonl'));
      
      let totalSize = 0;
      let totalEntries = 0;
      
      for (const file of logFiles) {
        const filePath = path.join(this.logsDir, file);
        
        if (fs.existsSync(filePath)) {
          const stats = await fs.promises.stat(filePath);
          totalSize += stats.size;
          
          // Count lines in file
          const content = await fs.promises.readFile(filePath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          totalEntries += lines.length;
        }
      }
      
      return {
        totalFiles: logFiles.length,
        totalSize,
        totalEntries,
        formattedSize: this.formatBytes(totalSize),
        clearInterval: '30 minutes'
      };
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return { totalFiles: 0, totalSize: 0, totalEntries: 0, formattedSize: '0 B', clearInterval: '30 minutes' };
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = new LogStorageService();