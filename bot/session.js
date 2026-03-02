const path = require('path');
const fs = require('fs');

const SESSION_DIR = path.join(__dirname, './session_data');

function getSessionPath(basePath) {
    return path.join(basePath, 'session_data');
}

async function getSession(sessionDir) {
    const { useMultiFileAuthState } = await import('@whiskeysockets/baileys');
    return await useMultiFileAuthState(sessionDir || path.join(__dirname, './session_data'));
}

function clearSession(sessionDir) {
    const target = sessionDir || path.join(__dirname, './session_data');
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        console.log('Session data cleared.');
    }
}

module.exports = { getSession, clearSession, getSessionPath };
