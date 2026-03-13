const express = require('express');
const { connectToWhatsApp } = require('./connection');
const { handleIncomingMessage } = require('./listener');
const logger = require('./logger');
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
                if (update.type === 'qr') {
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


async function startAllSessions() {
    logger.info('🔍 Scanning for existing WhatsApp sessions to restore...');
    try {
        const sessionsDir = path.join(__dirname, 'sessions');
        if (!fs.existsSync(sessionsDir)) {
            logger.info('No sessions directory found. Skipping auto-restore.');
            return;
        }

        const folders = fs.readdirSync(sessionsDir);
        logger.info(`Found ${folders.length} folders in sessions directory.`);

        for (const folder of folders) {
            // Identifier format: companyId-sessionId (e.g., global-client1)
            const parts = folder.split('-');
            if (parts.length >= 2) {
                const companyId = parts[0];
                const sessionId = parts.slice(1).join('-'); // handles sessionIds with dashes
                
                logger.info(`♻️ Restoring session: [Company: ${companyId}, ID: ${sessionId}]`);
                // Use a slight delay between starts to avoid overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 2000));
                startSession(companyId, sessionId).catch(err => {
                    logger.error(`Failed to restore ${companyId}:${sessionId}: ${err.message}`);
                });
            }
        }
    } catch (e) {
        logger.error('Failed to autostart sessions:', e.message);
    }
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
