const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
const pino = require("pino");
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    Browsers, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const { upload } = require('./mega');

const router = express.Router();

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;
    
    if (!num || !/^\d+$/.test(num.replace(/[^0-9]/g, ''))) {
        return res.status(400).json({
            status: "error",
            message: "Valid phone number is required"
        });
    }

    async function MTEE_XMD_PAIR_CODE() {
        let sock;
        try {
            const { state, saveCreds } = await useMultiFileAuthState(`./temp/${id}`);
            
            sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
                syncFullHistory: false,
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us')
            });

            // First request the pairing code
            const cleanNumber = num.replace(/[^0-9]/g, '');
            const pairingCode = await sock.requestPairingCode(cleanNumber);
            
            // Immediately respond with pairing code
            res.json({
                status: "success",
                pairingCode,
                message: "Enter this code in WhatsApp > Linked Devices"
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'open') {
                    try {
                        const credsPath = `${__dirname}/temp/${id}/creds.json`;
                        
                        // Verify credentials exist
                        if (!fs.existsSync(credsPath)) {
                            throw new Error("Authentication credentials not found");
                        }
                        
                        // Upload session
                        const megaUrl = await upload(
                            fs.createReadStream(credsPath),
                            `${sock.user.id}.json`
                        );
                        
                        const sessionId = `mtee~${megaUrl.replace('https://mega.nz/file/', '')}`;
                        
                        // Send session to WhatsApp
                        await sock.sendMessage(sock.user.id, {
                            text: `*Mtee-xmd Session Created* ✅\n\n` +
                                  `🔐 Session ID:\n\`\`\`${sessionId}\`\`\`\n\n` +
                                  `⚠️ Keep this secure and don't share!`
                        });
                        
                    } catch (e) {
                        console.error('Session processing error:', e);
                        if (sock.user?.id) {
                            await sock.sendMessage(sock.user.id, {
                                text: `❌ Session creation failed:\n${e.message}`
                            });
                        }
                    } finally {
                        // Cleanup
                        if (sock) {
                            await sock.ws.close();
                        }
                        removeFile(`./temp/${id}`);
                    }
                }
                
                if (connection === 'close' && lastDisconnect?.error) {
                    console.log('Connection closed:', lastDisconnect.error);
                    if (lastDisconnect.error.output?.statusCode !== 401) {
                        await delay(2000);
                        MTEE_XMD_PAIR_CODE().catch(console.error);
                    }
                }
            });

        } catch (err) {
            console.error('Initialization error:', err);
            
            // Only respond if no response sent yet
            if (!res.headersSent) {
                res.status(500).json({
                    status: "error",
                    message: "Failed to initialize connection",
                    error: err.message
                });
            }
            
            // Cleanup
            if (sock) {
                await sock.ws.close().catch(console.error);
            }
            removeFile(`./temp/${id}`).catch(console.error);
        }
    }

    MTEE_XMD_PAIR_CODE().catch(err => {
        if (!res.headersSent) {
            res.status(500).json({
                status: "error",
                message: "Unexpected error",
                error: err.message
            });
        }
    });
});

module.exports = router;