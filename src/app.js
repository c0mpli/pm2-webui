#!/usr/bin/env node

const config = require("./config");
const { setEnvDataSync } = require("./utils/env.util");
const { generateRandomString } = require("./utils/random.util");
const path = require("path");
const serve = require("koa-static");
const render = require("koa-ejs");
const koaBody = require("koa-body");
const session = require("koa-session");
const Koa = require("koa");
const { Server } = require("socket.io");
const pm2 = require("pm2");
const AnsiConverter = require("ansi-to-html");
const ansiConvert = new AnsiConverter();
const logStorage = require("./services/log-storage.service");

// Init Application

if (!config.APP_USERNAME || !config.APP_PASSWORD) {
  console.log(
    "You must first setup admin user. Run command -> npm run setup-admin-user"
  );
  process.exit(2);
}

if (!config.APP_SESSION_SECRET) {
  const randomString = generateRandomString();
  setEnvDataSync(config.APP_DIR, { APP_SESSION_SECRET: randomString });
  config.APP_SESSION_SECRET = randomString;
}

// Create App Instance
const app = new Koa();

// App Settings
app.proxy = true;
app.keys = [config.APP_SESSION_SECRET];

// Middlewares
app.use(session(app));

app.use(koaBody());

app.use(serve(path.join(__dirname, "public")));

const router = require("./routes");
app.use(router.routes());

render(app, {
  root: path.join(__dirname, "views"),
  layout: "base",
  viewExt: "html",
  cache: false,
  debug: false,
});

const _server = app.listen(config.PORT, config.HOST, () => {
  console.log(`Application started at http://${config.HOST}:${config.PORT}`);
});

// Helper function to store logs
function parseLogData(rawData, coloredData) {
  // Remove HTML tags for parsing
  const cleanData = coloredData.replace(/<[^>]*>/g, '').trim();
  
  // Try to parse structured log format: [TIMESTAMP] LEVEL :: ACTION | JSON_DATA
  const structuredLogMatch = cleanData.match(/^\[([^\]]+)\]\s*(\w+)\s*::\s*([^|]+)(?:\s*\|\s*(.+))?$/);
  
  if (structuredLogMatch) {
    let jsonData = null;
    if (structuredLogMatch[4]) {
      try {
        jsonData = JSON.parse(structuredLogMatch[4]);
      } catch (e) {
        jsonData = structuredLogMatch[4];
      }
    }
    
    return {
      level: structuredLogMatch[2].toLowerCase(),
      message: structuredLogMatch[3].trim(),
      jsonData,
      raw: coloredData
    };
  }
  
  // Fallback for unstructured logs
  return {
    level: 'info',
    message: cleanData,
    jsonData: null,
    raw: coloredData
  };
}

async function storeLogEntry(appName, logType, originalData, coloredData) {
  try {
    const logData = parseLogData(originalData, coloredData);
    await logStorage.storeLog(appName, logType, logData);
  } catch (error) {
    console.error('Error storing log entry:', error);
  }
}

const io = new Server(_server);
io.on("connection", async (socket) => {
  pm2.launchBus((err, bus) => {
    if (err) {
      console.log(err);
    } else {
      bus.on("log:out", (log) => {
        const originalData = log.data;
        log.data = ansiConvert.toHtml(log.data);
        log.logType = "log-out";
        
        // Store log with parsed data
        storeLogEntry(log.process.name, "stdout", originalData, log.data);
        
        socket.emit("log", log);
      });

      bus.on("log:err", (log) => {
        const originalData = log.data;
        log.data = ansiConvert.toHtml(log.data);
        log.logType = "log-err";
        
        // Store log with parsed data
        storeLogEntry(log.process.name, "stderr", originalData, log.data);
        
        socket.emit("log", log);
      });
    }
  });
});
