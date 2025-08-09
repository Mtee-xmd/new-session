const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require("pino");
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    Browsers, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const { upload } = require('./mega');

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;
    
    if (!num) {
        return res.status(400).send({
            status: "error",
            message: "Phone number is required"
        });
    }

    async function MTEE_XMD_PAIR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        let sock;
        
        try {
            sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS("Safari")
            });

            // Request pairing code first
            num = num.replace(/[^0-9]/g, '');
            const pairingCode = await sock.requestPairingCode(num);
            
            // Immediately send pairing code to client
            res.send({
                status: "success",
                pairingCode: pairingCode,
                message: "Enter this code in your WhatsApp linked devices"
            });

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === "open") {
                    try {
                        const rf = __dirname + `/temp/${id}/creds.json`;
                        const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
                        const sessionId = "mtee~" + mega_url.replace('https://mega.nz/file/', '');
                        
                        // Send session to WhatsApp
                        await sock.sendMessage(sock.user.id, {
                            text: `🔐 *Your Session ID* 🔐\n\n` +
                                  `\`\`\`${sessionId}\`\`\`\n\n` +
                                  `⚠️ Keep this secure!`
                        });
                        
                        console.log("Session created successfully for:", sock.user.id);
                        
                    } catch (e) {
                        console.error("Session creation error:", e);
                        await sock.sendMessage(sock.user.id, {
                            text: `❌ Session creation failed:\n${e.message}`
                        });
                    } finally {
                        await sock.ws.close();
                        removeFile('./temp/' + id);
                    }
                }
                
                if (connection === "close") {
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        await delay(2000);
                        MTEE_XMD_PAIR_CODE();
                    }
                }
            });

        } catch (err) {
            console.error("Initialization error:", err);
            if (!res.headersSent) {
                res.status(500).send({
                    status: "error",
                    message: "Failed to initialize connection",
                    error: err.message
                });
            }
            if (sock) await sock.ws.close();
            removeFile('./temp/' + id);
        }
    }

    MTEE_XMD_PAIR_CODE();
});

module.exports = router;