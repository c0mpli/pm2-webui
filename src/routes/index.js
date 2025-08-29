const config = require("../config");
const RateLimit = require("koa2-ratelimit").RateLimit;
const router = require("@koa/router")();
const {
  listApps,
  describeApp,
  reloadApp,
  restartApp,
  stopApp,
} = require("../providers/pm2/api");
const { validateAdminUser } = require("../services/admin.service");
const { readLogsReverse } = require("../utils/read-logs.util");
const logStorage = require("../services/log-storage.service");
const {
  getCurrentGitBranch,
  getCurrentGitCommit,
} = require("../utils/git.util");
const { getEnvFileContent } = require("../utils/env.util");
const { isAuthenticated, checkAuthentication } = require("../middlewares/auth");
const AnsiConverter = require("ansi-to-html");
const ansiConvert = new AnsiConverter();

const loginRateLimiter = RateLimit.middleware({
  interval: 2 * 60 * 1000, // 2 minutes
  max: 100,
  prefixKey: "/login", // to allow the bdd to Differentiate the endpoint
});

router.get("/", async (ctx) => {
  return ctx.redirect("/login");
});

router.get("/login", loginRateLimiter, checkAuthentication, async (ctx) => {
  return await ctx.render("auth/login", {
    layout: false,
    login: { username: "", password: "", error: null },
  });
});

router.post("/login", loginRateLimiter, checkAuthentication, async (ctx) => {
  const { username, password } = ctx.request.body;
  try {
    await validateAdminUser(username, password);
    ctx.session.isAuthenticated = true;
    return ctx.redirect("/apps");
  } catch (err) {
    return await ctx.render("auth/login", {
      layout: false,
      login: { username, password, error: err.message },
    });
  }
});

router.get("/apps", isAuthenticated, async (ctx) => {
  const apps = await listApps();
  return await ctx.render("apps/dashboard", {
    apps,
  });
});

router.get("/logout", (ctx) => {
  ctx.session = null;
  return ctx.redirect("/login");
});

router.get("/apps/:appName", isAuthenticated, async (ctx) => {
  const { appName } = ctx.params;
  let app = await describeApp(appName);
  if (app) {
    app.git_branch = await getCurrentGitBranch(app.pm2_env_cwd);
    app.git_commit = await getCurrentGitCommit(app.pm2_env_cwd);
    app.env_file = await getEnvFileContent(app.pm2_env_cwd);
    const stdout = await readLogsReverse({ filePath: app.pm_out_log_path });
    const stderr = await readLogsReverse({ filePath: app.pm_err_log_path });
    stdout.lines = stdout.lines
      .map((log) => {
        return ansiConvert.toHtml(log);
      })
      .join("<br/>");
    stderr.lines = stderr.lines
      .map((log) => {
        return ansiConvert.toHtml(log);
      })
      .join("<br/>");
    return await ctx.render("apps/app", {
      app,
      logs: {
        stdout,
        stderr,
      },
    });
  }
  return ctx.redirect("/apps");
});

// Legacy endpoint - moved after specific routes to avoid conflicts
// This endpoint reads from log files directly (old system)
// New endpoints use database storage system

router.post("/api/apps/:appName/reload", isAuthenticated, async (ctx) => {
  try {
    let { appName } = ctx.params;
    let apps = await reloadApp(appName);
    if (Array.isArray(apps) && apps.length > 0) {
      return (ctx.body = {
        success: true,
      });
    }
    return (ctx.body = {
      success: false,
    });
  } catch (err) {
    return (ctx.body = {
      error: err,
    });
  }
});

router.post("/api/apps/:appName/restart", isAuthenticated, async (ctx) => {
  try {
    let { appName } = ctx.params;
    let apps = await restartApp(appName);
    if (Array.isArray(apps) && apps.length > 0) {
      return (ctx.body = {
        success: true,
      });
    }
    return (ctx.body = {
      success: false,
    });
  } catch (err) {
    console.log(err);
    return (ctx.body = {
      error: err,
    });
  }
});

router.post("/api/apps/:appName/stop", isAuthenticated, async (ctx) => {
  try {
    let { appName } = ctx.params;
    let apps = await stopApp(appName);
    if (Array.isArray(apps) && apps.length > 0) {
      return (ctx.body = {
        success: true,
      });
    }
    return (ctx.body = {
      success: false,
    });
  } catch (err) {
    return (ctx.body = {
      error: err,
    });
  }
});

// Search logs endpoint
router.get("/api/apps/:appName/logs/search", isAuthenticated, async (ctx) => {
  try {
    const { appName } = ctx.params;
    const { q: query, logType, hours = 0.5, limit = 100 } = ctx.query; // 30 minutes default

    if (!query || query.trim() === "") {
      return (ctx.body = {
        error: "Search query is required",
      });
    }

    const searchResults = await logStorage.searchLogs(appName, query, {
      logType: logType || null,
      hours: parseFloat(hours),
      limit: parseInt(limit),
    });

    // Convert stored logs to display format
    const formattedResults = searchResults.map((log) => ({
      timestamp: new Date(log.timestamp).toLocaleString(),
      level: log.parsed.level,
      message: log.parsed.message,
      jsonData: log.parsed.jsonData,
      raw: log.raw,
      logType: log.logType,
    }));

    return (ctx.body = {
      success: true,
      query,
      totalResults: formattedResults.length,
      results: formattedResults,
    });
  } catch (err) {
    console.error("Search error:", err);
    return (ctx.body = {
      error: "Search failed: " + err.message,
    });
  }
});

// Get recent logs endpoint
router.get("/api/apps/:appName/logs/recent", isAuthenticated, async (ctx) => {
  try {
    const { appName } = ctx.params;
    const { logType, hours = 0.5, limit = 50 } = ctx.query; // 30 minutes default

    const recentLogs = await logStorage.getRecentLogs(appName, logType, {
      hours: parseFloat(hours),
      limit: parseInt(limit),
    });

    const formattedLogs = recentLogs.map((log) => ({
      timestamp: new Date(log.timestamp).toLocaleString(),
      level: log.parsed.level,
      message: log.parsed.message,
      jsonData: log.parsed.jsonData,
      raw: log.raw,
      logType: log.logType,
    }));

    return (ctx.body = {
      success: true,
      totalLogs: formattedLogs.length,
      logs: formattedLogs,
    });
  } catch (err) {
    console.error("Recent logs error:", err);
    return (ctx.body = {
      error: "Failed to fetch recent logs: " + err.message,
    });
  }
});

// Get storage statistics
router.get("/api/logs/stats", isAuthenticated, async (ctx) => {
  try {
    const stats = await logStorage.getStorageStats();
    return (ctx.body = {
      success: true,
      ...stats,
    });
  } catch (err) {
    console.error("Storage stats error:", err);
    return (ctx.body = {
      error: "Failed to get storage stats: " + err.message,
    });
  }
});

// Download logs as text file
router.get("/api/apps/:appName/logs/download", isAuthenticated, async (ctx) => {
  try {
    const { appName } = ctx.params;
    const { hours = 0.5 } = ctx.query; // 30 minutes default

    const logs = await logStorage.getRecentLogs(appName, "stdout", {
      hours: parseFloat(hours),
      limit: 10000, // High limit for download
    });

    if (logs.length === 0) {
      return (ctx.body = {
        error: "No logs available for download",
      });
    }

    // Format logs as text
    const logText = logs
      .map((log) => {
        const timestamp = new Date(log.timestamp).toISOString();
        const jsonPart = log.parsed.jsonData
          ? ` | ${JSON.stringify(log.parsed.jsonData)}`
          : "";
        return `[${timestamp}] ${log.parsed.level.toUpperCase()} :: ${
          log.parsed.message
        }${jsonPart}`;
      })
      .join("\n");

    // Set headers for file download
    const filename = `${appName}_logs_${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, "-")}.txt`;
    ctx.set("Content-Type", "text/plain");
    ctx.set("Content-Disposition", `attachment; filename="${filename}"`);

    return (ctx.body = logText);
  } catch (err) {
    console.error("Download error:", err);
    return (ctx.body = {
      error: "Failed to download logs: " + err.message,
    });
  }
});

// Legacy endpoint - placed last to avoid route conflicts
// This endpoint reads from log files directly (old system)
router.get("/api/apps/:appName/logs/:logType", isAuthenticated, async (ctx) => {
  const { appName, logType } = ctx.params;
  const { linePerRequest, nextKey } = ctx.query;
  if (logType !== "stdout") {
    return (ctx.body = {
      error: "Log Type must be stdout (stderr is no longer supported)",
    });
  }
  const app = await describeApp(appName);
  const filePath =
    logType === "stdout" ? app.pm_out_log_path : app.pm_err_log_path;
  let logs = await readLogsReverse({ filePath, nextKey });
  logs.lines = logs.lines
    .map((log) => {
      return ansiConvert.toHtml(log);
    })
    .join("<br/>");
  return (ctx.body = {
    logs,
  });
});

module.exports = router;
