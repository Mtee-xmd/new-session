const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require("pino");
const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { upload } = require('./mega');

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

async function sendWhatsAppMessage(sock, jid, message, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const sentMsg = await sock.sendMessage(jid, message);
            return sentMsg;
        } catch (error) {
            if (i === retries - 1) throw error;
            await delay(2000 * (i + 1));
        }
    }
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;
    let sessionData = {};

    async function MTEE_XMD_PAIR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        try {
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: Browsers.macOS("Safari")
            });

            if (!sock.authState.creds.registered) {
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) {
                    res.send({ pairingCode: code, status: "awaiting_session" });
                }
            }

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
                if (connection === "open") {
                    try {
                        const rf = __dirname + `/temp/${id}/creds.json`;
                        const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
                        const sessionId = "mtee~" + mega_url.replace('https://mega.nz/file/', '');

                        // Send session ID to WhatsApp with error handling
                        try {
                            const msg = await sendWhatsAppMessage(sock, sock.user.id, {
                                text: `🔐 *Your Mtee-xmd Session ID* 🔐\n\n` +
                                      `\`\`\`${sessionId}\`\`\`\n\n` +
                                      `⚠️ Keep this secure and don't share with anyone!`
                            });

                            await sendWhatsAppMessage(sock, sock.user.id, {
                                text: `✅ *Session Setup Complete*\n\n` +
                                      `You can now use your Mtee-xmd bot!\n\n` +
                                      `📌 Session will automatically close...`,
                                contextInfo: {
                                    externalAdReply: {
                                        title: "Mtee-xmd",
                                        body: "Session Created Successfully",
                                        thumbnailUrl: "https://example.com/logo.jpg",
                                        sourceUrl: "https://github.com/mtee-xmd",
                                        mediaType: 1
                                    }
                                }
                            }, { quoted: msg });

                            // Send to website
                            if (!res.headersSent) {
                                res.send({
                                    status: "success",
                                    sessionId,
                                    userId: sock.user.id,
                                    timestamp: Date.now()
                                });
                            }

                        } catch (whatsappError) {
                            console.error("WhatsApp message failed:", whatsappError);
                            if (!res.headersSent) {
                                res.status(500).send({
                                    status: "whatsapp_delivery_failed",
                                    error: "Session created but failed to send WhatsApp message",
                                    sessionId,
                                    userId: sock.user.id
                                });
                            }
                        }

                    } catch (uploadError) {
                        console.error("Session creation failed:", uploadError);
                        try {
                            await sendWhatsAppMessage(sock, sock.user.id, {
                                text: `❌ *Session Creation Failed*\n\n` +
                                      `Error: ${uploadError.message}\n\n` +
                                      `Please try again or contact support.`
                            });
                        } catch (notificationError) {
                            console.error("Failed to send error notification:", notificationError);
                        }

                        if (!res.headersSent) {
                            res.status(500).send({
                                status: "error",
                                error: uploadError.message
                            });
                        }
                    } finally {
                        await sock.ws.close();
                        removeFile('./temp/' + id);
                        process.exit(0);
                    }
                }
                else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(2000);
                    MTEE_XMD_PAIR_CODE();
                }
            });

        } catch (initError) {
            console.error("Initialization error:", initError);
            if (!res.headersSent) {
                res.status(500).send({
                    status: "initialization_failed",
                    error: initError.message
                });
            }
            removeFile('./temp/' + id);
        }
    }

    MTEE_XMD_PAIR_CODE();
});

module.exports = router;