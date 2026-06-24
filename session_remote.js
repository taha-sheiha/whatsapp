const logger = require('./logger');

// Remote Session Config (via Cloudflare Worker)
const WORKER_URL = process.env.WORKER_URL || 'https://neura-worker.tahasheiha.workers.dev';
const WORKER_SESSION_URL = process.env.WORKER_SESSION_URL || `${WORKER_URL}/bot-session`;
const BOT_SECRET = process.env.BOT_SECRET;
if (!BOT_SECRET) {
    logger.error('[SECURITY ERROR] BOT_SECRET env variable is NOT set! Exiting immediately to prevent unauthorized access.');
    process.exit(1);
}

async function getRemoteAuthState(companyId, sessionId = 'neura-v3', forceResetKeys = false) {
    const { proto, initAuthCreds, BufferJSON } = await import('@whiskeysockets/baileys');

    let remoteData = { creds: null, keys: {}, jidMap: {} };

    // Function to load from remote
    const loadFromRemote = async (forceResetKeys = false) => {
        try {
            const res = await fetch(`${WORKER_SESSION_URL}?id=${sessionId}&companyId=${companyId}`, {
                headers: { 'Authorization': `Bearer ${BOT_SECRET}` }
            });
            if (res.ok) {
                const text = await res.text();
                if (text) {
                    const parsed = JSON.parse(text, BufferJSON.reviver);
                    remoteData = parsed.data || { creds: null, keys: {}, jidMap: {} };
                    if (!remoteData.keys) remoteData.keys = {};
                    if (!remoteData.jidMap) remoteData.jidMap = {};
                    
                    if (forceResetKeys) {
                        logger.warn(`[${sessionId}] Force resetting session keys for conflict resolution...`);
                        remoteData.keys = {};
                    }

                    if (remoteData.creds) logger.info(`Remote session [${companyId}:${sessionId}] loaded successfully ☁️`);
                }
            }
        } catch (e) {
            logger.error(`Failed to load remote session [${sessionId}]:`, e.message);
        }
    };

    let saveTimeout = null;

    // Function to save to remote
    const saveToRemote = async () => {
        try {
            const payload = JSON.stringify({ id: sessionId, companyId, data: remoteData }, BufferJSON.replacer);
            const res = await fetch(WORKER_SESSION_URL, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${BOT_SECRET}`
                },
                body: payload
            });
            if (!res.ok) {
                const errText = await res.text();
                logger.error(`Failed to save to remote session [${sessionId}]: ${res.status} ${errText}`);
            } else {
                logger.info(`[${sessionId}] Remote session state saved successfully ☁️`);
            }
        } catch (e) {
            logger.error(`Failed to save to remote session [${sessionId}]:`, e.message);
        }
    };

    const saveToRemoteDebounced = () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            await saveToRemote();
            saveTimeout = null;
        }, 200); // 200ms debounce delay (committed almost instantly to D1)
    };

    await loadFromRemote(forceResetKeys);

    // Initialize creds if not present
    if (!remoteData.creds) {
        remoteData.creds = initAuthCreds();
    }

    return {
        state: {
            creds: remoteData.creds,
            keys: {
                get: (type, ids) => {
                    const data = {};
                    ids.forEach(id => {
                        let value = remoteData.keys?.[`${type}-${id}`];
                        if (value) {
                            if (type === 'app-state-sync-key') {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        }
                    });
                    return data;
                },
                set: async (data) => {
                    if (!remoteData.keys) remoteData.keys = {};
                    for (const type in data) {
                        for (const id in data[type]) {
                            const value = data[type][id];
                            const key = `${type}-${id}`;
                            if (value) {
                                remoteData.keys[key] = value;
                            } else {
                                delete remoteData.keys[key];
                            }
                        }
                    }
                    saveToRemoteDebounced();
                }
            }
        },
        saveCreds: async () => {
            saveToRemoteDebounced();
        },
        flush: async () => {
            if (saveTimeout) {
                clearTimeout(saveTimeout);
                saveTimeout = null;
                logger.info(`[${sessionId}] Flushing pending auth state to remote...`);
                await saveToRemote();
            }
        },
        jidMap: remoteData.jidMap || {}
    };
}

/**
 * List all remote sessions from D1 for a given company (or all if no filter).
 * Used by startAllSessions() on server startup to restore sessions.
 */
async function listRemoteSessions() {
    try {
        const listUrl = WORKER_URL + '/bot-sessions-list';
        const res = await fetch(listUrl, {
            headers: { 'Authorization': `Bearer ${BOT_SECRET}` }
        });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) return data;
        }
        logger.warn('[Session List] No sessions returned from D1');
        return [];
    } catch (e) {
        logger.error('[Session List] Failed to list remote sessions:', e.message);
        return [];
    }
}

/**
 * Completely wipe the remote auth state from Cloudflare D1 database.
 * Used during logout / permanent disconnect to prevent key conflicts.
 */
async function deleteRemoteAuthState(companyId, sessionId = 'neura-v3') {
    try {
        const res = await fetch(`${WORKER_SESSION_URL}?id=${sessionId}&companyId=${companyId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${BOT_SECRET}` }
        });
        if (res.ok) {
            logger.info(`[${sessionId}] Remote session state deleted successfully from D1 ☁️`);
            return true;
        } else {
            const txt = await res.text();
            logger.error(`Failed to delete remote session [${sessionId}] from D1: ${res.status} ${txt}`);
            return false;
        }
    } catch (e) {
        logger.error(`Failed to delete remote session [${sessionId}] from D1:`, e.message);
        return false;
    }
}

module.exports = { getRemoteAuthState, listRemoteSessions, deleteRemoteAuthState };
