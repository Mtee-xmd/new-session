const { makeid } = require('./gen-id');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
let router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
} = require("@whiskeysockets/baileys");
const { upload } = require('./mega');

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();

    async function MTEE_XMD_PAIR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'temp', id));
        try {
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS("Desktop"),
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !res.headersSent) {
                    // Send QR as PNG image buffer response
                    const qrBuffer = await QRCode.toBuffer(qr);
                    res.writeHead(200, {
                        'Content-Type': 'image/png',
                        'Content-Length': qrBuffer.length
                    });
                    return res.end(qrBuffer);
                }

                if (connection === "open") {
                    await delay(5000);
                    const credsPath = path.join(__dirname, 'temp', id, 'creds.json');
                    const data = fs.readFileSync(credsPath);

                    function generateRandomText() {
                        const prefix = "3EB";
                        const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                        let randomText = prefix;
                        for (let i = prefix.length; i < 22; i++) {
                            const randomIndex = Math.floor(Math.random() * characters.length);
                            randomText += characters.charAt(randomIndex);
                        }
                        return randomText;
                    }

                    const randomText = generateRandomText();

                    try {
                        const mega_url = await upload(fs.createReadStream(credsPath), `${sock.user.id}.json`);
                        const string_session = mega_url.replace('https://mega.nz/file/', '');
                        let md = "" + string_session;
                        let codeMsg = await sock.sendMessage(sock.user.id, { text: md });

                        let desc = `*Hey there, MTEE-XMD User!* 👋🏻

Thanks for using *MTEE-XMD* — your session has been successfully created!

🔐 *Session ID:* Sent above  
⚠️ *Keep it safe!* Do NOT share this ID with anyone.

——————

*✅ Stay Updated:*  
Join our official WhatsApp Channel:  
https://whatsapp.com/channel/0029Vb6EJfCHLHQQGd2KGL1P

*💻 Source Code:*  
Fork & explore the project on GitHub:  
https://github.com/Mtee-xmd/MTEE-XMD 

——————

> *© Powered by bleurainz tech*
Stay cool and hack smart. ✌🏻`;

                        await sock.sendMessage(sock.user.id, {
                            text: desc,
                            contextInfo: {
                                externalAdReply: {
                                    title: "MTEE-XMD Connected",
                                    thumbnailUrl: "https://files.catbox.moe/iegt2p.jpg",
                                    sourceUrl: "https://whatsapp.com/channel/0029Vb6EJfCHLHQQGd2KGL1P",
                                    mediaType: 1,
                                    renderLargerThumbnail: true
                                }
                            }
                        }, { quoted: codeMsg });
                    } catch (e) {
                        let ddd = await sock.sendMessage(sock.user.id, { text: e.toString() });
                        let desc = `*Hey there, MTEE-XMD User!* 👋🏻

Thanks for using *MTEE-XMD* — your session has been successfully created!

🔐 *Session ID:* Sent above  
⚠️ *Keep it safe!* Do NOT share this ID with anyone.

——————

*✅ Stay Updated:*  
Join our official WhatsApp Channel:  
https://whatsapp.com/channel/0029Vb6EJfCHLHQQGd2KGL1P

*💻 Source Code:*  
Fork & explore the project on GitHub:  
https://github.com/Mtee-xmd/MTEE-XMD 

> *© Powered by BLEURAINZ*
Stay cool and hack smart. ✌🏻*`;

                        await sock.sendMessage(sock.user.id, {
                            text: desc,
                            contextInfo: {
                                externalAdReply: {
                                    title: "MTEE-XMD Connected ✅",
                                    thumbnailUrl: "https://files.catbox.moe/iegt2p.jpg",
                                    sourceUrl: "https://whatsapp.com/channel/0029Vb6EJfCHLHQQGd2KGL1P",
                                    mediaType: 2,
                                    renderLargerThumbnail: true,
                                    showAdAttribution: true
                                }
                            }
                        }, { quoted: ddd });
                    }

                    await delay(10);
                    await sock.ws.close();
                    await removeFile(path.join(__dirname, 'temp', id));
                    console.log(`👤 ${sock.user.id} Connected ✅ Process finished, server still running.`);
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10);
                    // retry pairing on unexpected disconnect
                    MTEE_XMD_PAIR_CODE();
                }
            });

        } catch (err) {
            console.log("Service restarted due to error:", err);
            await removeFile(path.join(__dirname, 'temp', id));
            if (!res.headersSent) {
                res.send({ code: "❗ Service Unavailable" });
            }
        }
    }

    await MTEE_XMD_PAIR_CODE();
});

// Optional: Remove or comment out this forced process exit if you want persistent server
// setInterval(() => {
//     console.log("☘️ Restarting process...");
//     process.exit();
// }, 180000); // 3 minutes

module.exports = router;