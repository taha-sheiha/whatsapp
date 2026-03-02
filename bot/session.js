import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.join(__dirname, './session_data');

export function getSessionPath(basePath) {
    return path.join(basePath, 'session_data');
}

export async function getSession(sessionDir) {
    const { useMultiFileAuthState } = await import('@whiskeysockets/baileys');
    return await useMultiFileAuthState(sessionDir || path.join(__dirname, './session_data'));
}

export function clearSession(sessionDir) {
    const target = sessionDir || path.join(__dirname, './session_data');
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        console.log('Session data cleared.');
    }
}
