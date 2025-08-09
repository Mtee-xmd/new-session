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

const router = express.Router();
const logger = pino({
    level: 'debug',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: true
        }
    }
});

// Session management
const activeSessions = new Map();

async function cleanupSession(id) {
    const dirPath = `./temp/${id}`;
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            logger.debug(`Cleaned up session files for ${id}`);
        }
        activeSessions.delete(id);
    } catch (e) {
        logger.error(`Cleanup failed for ${id}: ${e.message}`);
    }
}

// Connection manager
class ConnectionManager {
    constructor() {
        this.retryDelays = [2000, 5000, 10000]; // Progressive delays
    }

    async createConnection(sessionId, number) {
        let attempt = 0;
        
        while (attempt < this.retryDelays.length) {
            try {
                const { state, saveCreds } = await useMultiFileAuthState(`./temp/${sessionId}`);
                
                const sock = makeWASocket({
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, logger),
                    },
                    logger: logger.child({ session: sessionId }),
                    printQRInTerminal: false,
                    browser: Browsers.macOS("Safari"),
                    connectTimeoutMs: 30000,
                    keepAliveIntervalMs: 25000,
                    maxRetries: 3,
                    version: [2, 2413, 1],
                    getMessage: async () => ({})
                });

                // Setup event handlers
                sock.ev.on('creds.update', saveCreds);
                
                sock.ev.on('connection.update', (update) => {
                    logger.debug(`Connection update: ${JSON.stringify(update)}`);
                    
                    if (update.connection === 'close') {
                        this.handleDisconnect(sessionId, sock, update.lastDisconnect?.error);
                    }
                });

                // Request pairing code
                const pairingCode = await this.requestPairingCodeWithRetry(sock, number);
                
                return {
                    sock,
                    pairingCode
                };

            } catch (err) {
                attempt++;
                logger.error(`Attempt ${attempt} failed: ${err.message}`);
                
                if (attempt >= this.retryDelays.length) {
                    throw err;
                }
                
                await delay(this.retryDelays[attempt - 1]);
            }
        }
    }

    async requestPairingCodeWithRetry(sock, number, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                return await sock.requestPairingCode(number);
            } catch (err) {
                if (i === retries - 1) throw err;
                await delay(2000 * (i + 1));
            }
        }
    }

    async handleDisconnect(sessionId, sock, error) {
        try {
            logger.warn(`Disconnected: ${error?.message || 'No error'}`);
            
            if (error?.output?.statusCode === 428) {
                logger.info('Precondition required - restarting connection');
                await delay(2000);
                await this.createConnection(sessionId, sock.user?.id.split('@')[0]);
                return;
            }
            
            if (sock) {
                await sock.ws.close();
            }
        } catch (e) {
            logger.error(`Error handling disconnect: ${e.message}`);
        } finally {
            await cleanupSession(sessionId);
        }
    }
}

const connectionManager = new ConnectionManager();

router.get('/', async (req, res) => {
    const sessionId = makeid();
    const number = req.query.number?.replace(/[^0-9]/g, '');

    if (!number || number.length < 10) {
        return res.status(400).json({
            status: "error",
            message: "Valid phone number is required"
        });
    }

    try {
        const { sock, pairingCode } = await connectionManager.createConnection(sessionId, number);
        
        activeSessions.set(sessionId, {
            socket: sock,
            createdAt: Date.now()
        });

        // Respond with pairing code
        res.json({
            status: "success",
            pairingCode,
            sessionId,
            message: "Enter this code in WhatsApp > Linked Devices"
        });

        // Handle successful connection
        sock.ev.on('connection.update', async (update) => {
            if (update.connection === 'open') {
                try {
                    logger.info(`Session ${sessionId} connected successfully`);
                    
                    // Here you would add your session upload logic
                    // and WhatsApp message sending code
                    
                } catch (e) {
                    logger.error(`Post-connection error: ${e.message}`);
                } finally {
                    await delay(5000); // Keep connection briefly for messages
                    await sock.ws.close();
                    await cleanupSession(sessionId);
                }
            }
        });

    } catch (error) {
        logger.error(`Session creation failed: ${error.message}`);
        
        if (!res.headersSent) {
            res.status(503).json({
                status: "error",
                message: "Service unavailable",
                error: error.message
            });
        }
        
        await cleanupSession(sessionId);
    }
});

// Cleanup interval
setInterval(() => {
    const now = Date.now();
    activeSessions.forEach((session, id) => {
        if (now - session.createdAt > 300000) { // 5 minute timeout
            cleanupSession(id);
        }
    });
}, 60000); // Check every minute

module.exports = router;