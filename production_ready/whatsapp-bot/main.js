const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('./whatsapp/logger');

let mainWindow;

// Global paths (initialized after app ready)
let CONFIG_PATH;
let SESSION_BASE_PATH;
const DEFAULT_CONFIG = {
    apiUrl: 'https://ai.tahasheiha.workers.dev/chat'
};

// Stats Tracking
let stats = {
    dailyMessages: 0,
    totalResponseTime: 0,
    messageCount: 0
};

function initPaths() {
    CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
    SESSION_BASE_PATH = app.getPath('userData');
}

function loadConfig() {
    if (!CONFIG_PATH) initPaths();
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (e) {
            return DEFAULT_CONFIG;
        }
    }
    return DEFAULT_CONFIG;
}

function saveConfig(config) {
    if (!CONFIG_PATH) initPaths();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: false
        }
    });

    mainWindow.loadFile('gui/index.html');
    Menu.setApplicationMenu(null);
}

const startApp = async () => {
    initPaths();
    createWindow();

    // Start WhatsApp after window is ready
    mainWindow.webContents.once('did-finish-load', () => {
        startWhatsApp();
    });

    // Send initial stats
    setInterval(() => {
        if (mainWindow) {
            mainWindow.webContents.send('stats-update', stats);
        }
    }, 5000);
};

async function startWhatsApp() {
    try {
        const config = loadConfig();
        const { connectToWhatsApp } = require('./whatsapp/connection');
        const { handleIncomingMessage } = require('./whatsapp/listener');
        const { getSessionPath } = require('./whatsapp/session');

        const sessionDir = getSessionPath(SESSION_BASE_PATH);

        await connectToWhatsApp(
            (sock, msg) => {
                const start = Date.now();
                handleIncomingMessage(sock, msg, config.apiUrl).then(() => {
                    const duration = (Date.now() - start) / 1000;
                    stats.dailyMessages++;
                    stats.totalResponseTime += duration;
                    stats.messageCount++;
                    stats.speed = (stats.totalResponseTime / stats.messageCount).toFixed(1);
                });

                mainWindow.webContents.send('new-log', {
                    time: new Date().toLocaleTimeString(),
                    text: `رسالة من: ${msg.key.remoteJid}`
                });
            },
            (update) => {
                // Auto-restart on session expiry (401)
                if (update.type === 'status' && update.data === 'disconnected' && update.code === 401) {
                    const sessionDir = getSessionPath(SESSION_BASE_PATH);
                    const { clearSession } = require('./whatsapp/session');
                    clearSession(sessionDir);
                    app.relaunch();
                    app.exit();
                    return;
                }

                if (mainWindow) {
                    mainWindow.webContents.send('whatsapp-update', update);
                }
            },
            sessionDir
        );
    } catch (error) {
        logger.error('CRITICAL: Failed to connect to WhatsApp:', error.message || error);
    }
}

app.whenReady().then(startApp);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (event, config) => {
    saveConfig(config);
    return { success: true };
});

ipcMain.handle('clear-session', () => {
    const { clearSession, getSessionPath } = require('./whatsapp/session');
    const sessionDir = getSessionPath(app.getPath('userData'));
    clearSession(sessionDir);
    app.relaunch();
    app.exit();
});
