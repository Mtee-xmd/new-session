const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
const pino = require("pino");
const { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    Browsers, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const { upload } = require('./mega');

const router = express.Router();
const logger = pino({ level: 'debug' });

// Ensure temp directory exists
if (!fs.existsSync('./temp')) {
    fs.mkdirSync('./temp');
}

async function cleanupSession(id) {
    const dirPath = `./temp/${id}`;
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            logger.debug(`Cleaned up session files for ${id}`);
        }
    } catch (e) {
        logger.error(`Failed to cleanup session ${id}: ${e.message}`);
    }
}

router.get('/', async (req, res) => {
    const sessionId = makeid();
    let num = req.query.number;

    // Validate phone number
    if (!num || !/^[0-9]+$/.test(num.replace(/[^0-9]/g, ''))) {
        return res.status(400).json({
            status: "error",
            message: "Valid phone number is required"
        });
    }

    num = num.replace(/[^0-9]/g, '');

    async function establishConnection() {
        let sock;
        let connectionAttempts = 0;
        const maxAttempts = 3;

        while (connectionAttempts < maxAttempts) {
            try {
                connectionAttempts++;
                logger.info(`Connection attempt ${connectionAttempts}/${maxAttempts}`);

                const { state, saveCreds } = await useMultiFileAuthState(`./temp/${sessionId}`);
                
                sock = makeWASocket({
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, logger),
                    },
                    printQRInTerminal: false,
                    logger: logger,
                    browser: Browsers.macOS("Safari"),
                    syncFullHistory: false,
                    connectTimeoutMs: 30000,
                    keepAliveIntervalMs: 25000,
                    maxIdleTimeMs: 60000,
                    getMessage: async () => ({}),
                    version: [2, 2413, 1]
                });

                // Get pairing code
                const pairingCode = await sock.requestPairingCode(num);
                
                // Respond to client immediately
                res.json({
                    status: "success",
                    pairingCode,
                    message: "Enter this code in WhatsApp > Linked Devices"
                });

                // Handle credentials updates
                sock.ev.on('creds.update', saveCreds);

                // Handle connection events
                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;
                    
                    if (connection === 'open') {
                        logger.info(`Connected to ${sock.user.id}`);
                        
                        try {
                            const credsPath = `./temp/${sessionId}/creds.json`;
                            if (!fs.existsSync(credsPath)) {
                                throw new Error("Authentication credentials not found");
                            }

                            // Upload session file
                            const megaUrl = await upload(
                                fs.createReadStream(credsPath),
                                `${sock.user.id}.json`
                            );
                            
                            const sessionToken = `mtee~${megaUrl.replace('https://mega.nz/file/', '')}`;
                            
                            // Send session info to user
                            await sock.sendMessage(sock.user.id, {
                                text: `*Session Created* ✅\n\n` +
                                      `🔐 Session ID:\n\`\`\`${sessionToken}\`\`\`\n\n` +
                                      `⚠️ Keep this secure!`
                            });

                        } catch (e) {
                            logger.error(`Session processing error: ${e.message}`);
                            if (sock.user?.id) {
                                await sock.sendMessage(sock.user.id, {
                                    text: `❌ Session creation failed:\n${e.message}`
                                }).catch(e => logger.error(`Failed to send error message: ${e.message}`));
                            }
                        } finally {
                            // Graceful shutdown
                            try {
                                if (sock) {
                                    await sock.ws.close();
                                    logger.info('Connection closed gracefully');
                                }
                            } catch (e) {
                                logger.error(`Error closing connection: ${e.message}`);
                            }
                            await cleanupSession(sessionId);
                        }
                    }
                    
                    if (connection === 'close') {
                        const error = lastDisconnect?.error;
                        logger.warn(`Connection closed: ${error?.message || 'No error provided'}`);
                        
                        if (error?.output?.statusCode !== 401) {
                            const retryDelay = Math.min(2000 * connectionAttempts, 10000);
                            logger.info(`Will retry in ${retryDelay}ms...`);
                            await delay(retryDelay);
                            continue; // Retry the connection
                        }
                    }
                });

                // If we get here, connection was successful
                return;

            } catch (err) {
                logger.error(`Connection error (attempt ${connectionAttempts}): ${err.message}`);
                
                if (connectionAttempts >= maxAttempts) {
                    if (!res.headersSent) {
                        res.status(503).json({
                            status: "error",
                            message: "Service unavailable",
                            error: err.message,
                            attempts: connectionAttempts
                        });
                    }
                    await cleanupSession(sessionId);
                    throw err;
                }
                
                // Cleanup before retry
                try {
                    if (sock) {
                        await sock.ws.close();
                    }
                } catch (e) {
                    logger.error(`Error during cleanup: ${e.message}`);
                }
                await delay(2000 * connectionAttempts);
            }
        }
    }

    try {
        await establishConnection();
    } catch (finalError) {
        logger.error(`Final connection failure: ${finalError.message}`);
        if (!res.headersSent) {
            res.status(500).json({
                status: "error",
                message: "Failed to establish connection",
                error: finalError.message
            });
        }
    }
});

module.exports = router;