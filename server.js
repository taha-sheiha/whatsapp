const express = require('express');
const { connectToWhatsApp } = require('./connection');
const { handleIncomingMessage } = require('./listener');
const logger = require('./logger');
const { listRemoteSessions } = require('./session_remote');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Multi-account session registry: sessionId -> { sock, status, qr, pairingCode, pendingAction }
const sessions = new Map(); // combinedKey (companyId:sessionId) -> { sock, status, qr, pairingCode, pendingAction }
const pendingLogins = new Map();

async function startSession(companyId, sessionId) {
    const combinedKey = `${companyId}:${sessionId}`;
    if (sessions.has(combinedKey)) {
        const existing = sessions.get(combinedKey);
        if (existing.status === 'connected') {
            logger.info(`[${sessionId}] Already connected, skipping.`);
            return;
        }
    }

    // Initialize session state
    sessions.set(combinedKey, { sock: null, status: 'connecting', qr: null, pairingCode: null });
 
    try {
        const sock = await connectToWhatsApp(
            (sock, msg, sid) => handleIncomingMessage(sock, msg, companyId, null, sid),
            (update) => {
                const sess = sessions.get(combinedKey) || {};
                if (update.type === 'sock') {
                    sess.sock = update.data;
                } else if (update.type === 'qr') {
                    sess.qr = update.data;
                    sess.status = 'disconnected';
                    sess.pairingCode = null;
                } else if (update.type === 'status') {
                    sess.status = update.data;
                    if (update.data === 'connected') {
                        sess.qr = null;
                        sess.pairingCode = null;
                    }
                }
                sessions.set(combinedKey, sess);
            },
            companyId,
            sessionId
        );
        const sess = sessions.get(combinedKey) || {};
        sess.sock = sock;
        sessions.set(combinedKey, sess);
    } catch (err) {
        logger.error(`[${combinedKey}] Failed to start: ${err.message}`);
        const sess = sessions.get(combinedKey) || {};
        sess.status = 'error';
        sessions.set(combinedKey, sess);
    }
}


/**
 * startAllSessions — restores WhatsApp sessions at bot startup.
 * Strategy: Load from D1 (survives Render restarts) as primary source.
 * Falls back to local disk scan as secondary (handles dev environments).
 */
async function startAllSessions() {
    logger.info('🔍 Restoring WhatsApp sessions from D1...');
    
    // --- Primary: Load from D1 via Worker API ---
    let d1Sessions = [];
    try {
        d1Sessions = await listRemoteSessions();
        logger.info(`☁️ Found ${d1Sessions.length} session(s) in D1.`);
    } catch (e) {
        logger.error('Failed to fetch sessions from D1:', e.message);
    }

    const seenKeys = new Set();
    
    for (const row of d1Sessions) {
        // row.id = "companyId:sessionId" format (as stored by bot server)
        const parts = (row.id || '').split(':');
        const companyId = row.company_id || parts[0];
        const sessionId = parts.length > 1 ? parts.slice(1).join(':') : row.id;

        if (!companyId || !sessionId) continue;
        const combinedKey = `${companyId}:${sessionId}`;
        if (seenKeys.has(combinedKey)) continue;
        seenKeys.add(combinedKey);

        logger.info(`♻️ [D1] Restoring session: [${combinedKey}]`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        startSession(companyId, sessionId).catch(err => {
            logger.error(`Failed to restore ${combinedKey}: ${err.message}`);
        });
    }

    // --- Fallback: Scan local disk (dev environment) ---
    const sessionsDir = path.join(__dirname, 'sessions');
    if (fs.existsSync(sessionsDir)) {
        const folders = fs.readdirSync(sessionsDir);
        logger.info(`💾 Disk fallback: Found ${folders.length} local session folder(s).`);
        for (const folder of folders) {
            const parts = folder.split('-');
            if (parts.length >= 2) {
                const companyId = parts[0];
                const sessionId = parts.slice(1).join('-');
                const combinedKey = `${companyId}:${sessionId}`;
                if (seenKeys.has(combinedKey)) continue; // already restored from D1
                seenKeys.add(combinedKey);
                logger.info(`♻️ [Disk] Restoring session: [${combinedKey}]`);
                await new Promise(resolve => setTimeout(resolve, 1500));
                startSession(companyId, sessionId).catch(err => {
                    logger.error(`Failed to restore disk ${combinedKey}: ${err.message}`);
                });
            }
        }
    }

    logger.info(`✅ Session restore complete. Total sessions attempted: ${seenKeys.size}`);
}
async function startServer() {
    logger.info('Starting Neriva Multi-Account WhatsApp Server...');
    await startAllSessions();

    app.use(express.json());
    app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT} 🚀`);
    });

    // ============================================================
    // API ROUTES (used by Neriva Dashboard)
    // ============================================================

    // GET /api/whatsapp/status?session=<id>&companyId=<cid>
    app.get('/api/whatsapp/status', (req, res) => {
        const { session, companyId } = req.query;
        if (!session || !companyId) return res.status(400).json({ error: 'session and companyId required' });
        
        const combinedKey = `${companyId}:${session}`;
        logger.info(`[Status API] Request for: ${combinedKey}`);
        
        const sess = sessions.get(combinedKey);
        if (!sess) {
            logger.warn(`[Status API] Session NOT FOUND in registry: ${combinedKey}`);
            return res.json({ status: 'not_started', qr: null, pairingCode: null });
        }
        
        logger.info(`[Status API] Found session. Status: ${sess.status}, Has QR: ${!!sess.qr}`);
        res.json({
            status: sess.status,
            qr: sess.qr,
            pairingCode: sess.pairingCode
        });
    });

    // POST /api/whatsapp/connect — start a session for a company
    app.post('/api/whatsapp/connect', async (req, res) => {
        const { session, companyId } = req.body;
        if (!session || !companyId) return res.status(400).json({ error: 'session and companyId required' });
        await startSession(companyId, session);
        res.json({ success: true, message: 'Session starting' });
    });

    // POST /api/whatsapp/send — send a manual message or media via WhatsApp
    app.post('/api/whatsapp/send', async (req, res) => {
        logger.info(`[WhatsApp Send] Incoming request:`, req.body);
        const { session, companyId, targetId, text } = req.body;
        if (!session || !companyId || !targetId || !text) {
            logger.warn(`[WhatsApp Send] Missing fields. Has: session=${session}, companyId=${companyId}, targetId=${targetId}, text length=${text?.length}`);
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const combinedKey = `${companyId}:${session}`;
        const sess = sessions.get(combinedKey);
        if (!sess || !sess.sock) {
            logger.warn(`[WhatsApp Send] Session not found/started for key: ${combinedKey}`);
            return res.status(404).json({ error: 'WhatsApp session not found or not connected' });
        }

        if (sess.status !== 'connected' && sess.status !== 'open') {
            logger.warn(`[WhatsApp Send] Session ${combinedKey} is not connected (Status: ${sess.status})`);
            return res.status(400).json({ error: `Connection is ${sess.status || 'disconnected'}. Please wait or re-scan QR.` });
        }

        try {
            const remoteJid = targetId.includes('@s.whatsapp.net') ? targetId : `${targetId}@s.whatsapp.net`;
            
            // Parse media tags
            let mediaUrl = null;
            let mediaType = 'text';
            let cleanText = text;
            
            const mediaMatch = text.match(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/i);
            if (mediaMatch) {
                mediaType = mediaMatch[1].toLowerCase();
                mediaUrl = mediaMatch[2].trim();
                cleanText = text.replace(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/gi, '').trim();
            }

            if (mediaUrl) {
                let msgPayload = {};
                if (mediaType === 'image') {
                    msgPayload = { image: { url: mediaUrl } };
                    if (cleanText) msgPayload.caption = cleanText;
                } else if (mediaType === 'video') {
                    msgPayload = { video: { url: mediaUrl } };
                    if (cleanText) msgPayload.caption = cleanText;
                } else {
                    msgPayload = { document: { url: mediaUrl }, fileName: 'Document' };
                    if (cleanText) msgPayload.caption = cleanText;
                }
                
                await sess.sock.sendMessage(remoteJid, msgPayload);
            } else {
                await sess.sock.sendMessage(remoteJid, { text: cleanText });
            }
            
            res.json({ success: true });
        } catch (e) {
            logger.error(`[WhatsApp Send] Failed to send manual message:`, e);
            res.status(500).json({ error: e.message || 'Failed to send WhatsApp message' });
        }
    });

    // POST /api/whatsapp/disconnect — logout a session
    app.post('/api/whatsapp/disconnect', async (req, res) => {
        const { session, companyId } = req.body;
        if (!session || !companyId) return res.status(400).json({ error: 'session and companyId required' });
        const combinedKey = `${companyId}:${session}`;
        const sess = sessions.get(combinedKey);
        if (sess?.sock) {
            try { await sess.sock.logout(); } catch (e) { /* ignore */ }
        }
        sessions.delete(combinedKey);
        
        // Delete local session folder
        const sessionDir = path.join(__dirname, 'sessions', `${companyId}-${session}`);
        if (fs.existsSync(sessionDir)) {
            try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) { logger.error('Failed to delete session dir', e); }
        }
        
        res.json({ success: true });
    });

    // GET /api/whatsapp/sessions — list all active sessions for a company
    app.get('/api/whatsapp/sessions', (req, res) => {
        const { companyId } = req.query;
        const list = [];
        sessions.forEach((v, k) => {
            const [cid, sid] = k.split(':');
            if (!companyId || cid === companyId) {
                list.push({ sessionId: sid, companyId: cid, status: v.status, hasQr: !!v.qr, hasPairingCode: !!v.pairingCode });
            }
        });
        res.json(list);
    });

    // GET /ping
    app.get('/ping', (req, res) => res.send('pong'));

    // Legacy QR web UI (for the default "neura-v3" session if auto-started)
    app.get('/', (req, res) => {
        const allSessions = [];
        sessions.forEach((v, k) => allSessions.push({ id: k, ...v }));
        res.json({
            status: 'Neriva Multi-Account Bot',
            sessions: allSessions.map(s => ({ id: s.id, status: s.status }))
        });
    });
}

startServer().catch(err => {
    logger.error('Server startup error:', err.message || err);
});
