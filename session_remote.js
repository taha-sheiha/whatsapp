const logger = require('./logger');

// Remote Session Config (via Cloudflare Worker)
const WORKER_SESSION_URL = process.env.WORKER_SESSION_URL || 'https://ai.tahasheiha.workers.dev/bot-session';
const BOT_SECRET = process.env.BOT_SECRET || 'NERIVA_MASTER_SECRET_2024';

async function getRemoteAuthState(companyId, sessionId = 'neura-v3', forceResetKeys = false) {
    const { proto, initAuthCreds, BufferJSON } = await import('@whiskeysockets/baileys');

    let remoteData = { creds: null, keys: {} };

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
                    remoteData = parsed.data || { creds: null, keys: {} };
                    
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
            }
        } catch (e) {
            logger.error(`Failed to save to remote session [${sessionId}]:`, e.message);
        }
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
                    await saveToRemote();
                }
            }
        },
        saveCreds: async () => {
            await saveToRemote();
            logger.info('Remote creds updated ✅');
        }
    };
}

module.exports = { getRemoteAuthState };
