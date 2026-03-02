const axios = require('axios');
const logger = require('./logger');

// Remote Session Config (via Cloudflare Worker)
const WORKER_SESSION_URL = process.env.WORKER_SESSION_URL || 'https://ai.tahasheiha.workers.dev/bot-session';

async function getRemoteAuthState(sessionId = 'neura-v1') {
    const { proto, initAuthCreds, BufferJSON } = await import('@whiskeysockets/baileys');

    let remoteData = { creds: null, keys: {} };

    // Function to load from remote
    const loadFromRemote = async () => {
        try {
            const res = await axios.get(`${WORKER_SESSION_URL}?id=${sessionId}`, {
                transformResponse: [data => data]
            });
            if (res.data) {
                const parsed = JSON.parse(res.data, BufferJSON.reviver);
                remoteData = parsed.data || { creds: null, keys: {} };
                if (remoteData.creds) logger.info('Remote session loaded successfully ☁️');
            }
        } catch (e) {
            logger.error('Failed to load remote session:', e.message);
        }
    };

    // Function to save to remote
    const saveToRemote = async () => {
        try {
            const payload = JSON.stringify({ id: sessionId, data: remoteData }, BufferJSON.replacer);
            await axios.post(WORKER_SESSION_URL, payload, {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) {
            logger.error('Failed to save to remote session:', e.message);
        }
    };

    await loadFromRemote();

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
                        let value = remoteData.keys[`${type}-${id}`];
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
