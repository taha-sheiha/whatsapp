import express from 'express';
import { connectToWhatsApp } from './connection.js';
import { handleIncomingMessage } from './listener.js';
import logger from './logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

let currentQR = null;
let botStatus = 'disconnected';

async function startServer() {
    logger.info('Starting Render Server for WhatsApp Bot...');

    // Start Express immediately so Render doesn't kill the process due to timeout
    app.listen(PORT, () => {
        logger.info(`Server is running on port ${PORT} 🚀`);
    });

    // Web Routes
    app.get('/', (req, res) => {
        const html = `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Neura Bot Control</title>
                <style>
                    body { font-family: 'Cairo', sans-serif; background: #0f172a; color: white; text-align: center; padding: 20px; margin: 0; }
                    .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); padding: 40px 20px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.1); display: inline-block; max-width: 500px; width: 90%; margin-top: 50px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
                    .status { font-weight: bold; margin: 20px 0; padding: 15px 25px; border-radius: 15px; display: inline-block; font-size: 1.1rem; }
                    .connected { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
                    .disconnected { background: rgba(220, 38, 38, 0.2); color: #f87171; border: 1px solid rgba(220, 38, 38, 0.3); }
                    img { background: white; padding: 15px; border-radius: 20px; margin-top: 25px; box-shadow: 0 0 30px rgba(56, 189, 248, 0.3); width: 250px; height: 250px; }
                    h1 { color: #38bdf8; font-size: 2rem; margin-bottom: 10px; }
                    p { color: #94a3b8; line-height: 1.6; }
                    .loader { border: 4px solid #f3f3f3; border-top: 4px solid #38bdf8; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 20px auto; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
                <script>
                    const currentStatus = '${botStatus}';
                    if (currentStatus !== 'connected') {
                        setInterval(() => location.reload(), 15000);
                    }
                </script>
            </head>
            <body>
                <div class="card">
                    <h1>Neura Bot Online 🌐</h1>
                    <p>منصة التحكم السحابية - CountaNeura</p>
                    
                    <div class="status ${botStatus === 'connected' ? 'connected' : 'disconnected'}">
                        ${botStatus === 'connected' ? 'الحالة: متصل بنجاح ✅' : 'الحالة: في انتظار الربط... ⏳'}
                    </div>

                    ${currentQR ? `
                        <div style="margin-top:20px;">
                            <p>افتح الواتساب على موبايلك واعمل Link a Device:</p>
                            <img src="${currentQR}" alt="QR Code">
                        </div>
                    ` : botStatus === 'connected' ? `
                        <div style="margin-top:20px;">
                            <p style="color: #4ade80;">البوت شغال دلوقتي وبيرد على الرسايل تلقائياً.</p>
                            <div style="font-size: 4rem;">🤖</div>
                        </div>
                    ` : `
                        <div class="loader"></div>
                        <p>جاري توليد الباركود، لحظات من فضلك...</p>
                    `}
                </div>
            </body>
            </html>
        `;
        res.send(html);
    });

    app.get('/ping', (req, res) => {
        res.send('pong');
    });

    // Start WhatsApp Bot in the background
    try {
        await connectToWhatsApp(
            handleIncomingMessage,
            (update) => {
                if (update.type === 'qr') {
                    currentQR = update.data;
                    botStatus = 'disconnected';
                } else if (update.type === 'status') {
                    botStatus = update.data;
                    if (update.data === 'connected') currentQR = null;
                }
            }
        );
    } catch (botErr) {
        logger.error(`WhatsApp Bot Initialization Failure: ${botErr.message || botErr}`);
        if (botErr.stack) logger.error(botErr.stack);
    }
}

startServer().catch(err => {
    logger.error('Unhandled Server Error:', err.message || err);
    if (err.stack) logger.error(err.stack);
});
