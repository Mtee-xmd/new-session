router.get('/', async (req, res) => {
  const id = makeid();
  let num = req.query.number;

  if (!num) {
    return res.status(400).json({ error: "Phone number required" });
  }
  num = num.replace(/[^0-9]/g, '');

  async function MTEE_XMD_PAIR_CODE() {
    const { state, saveCreds } = await useMultiFileAuthState(`./temp/${id}`);
    try {
      let sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })) },
        printQRInTerminal: false,
        browser: Browsers.macOS("Safari")
      });

      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(num);
        return res.json({ code }); // Send pairing code to user
      }

      sock.ev.on("connection.update", async (s) => {
        if (s.connection === "open") {
          const rf = `./temp/${id}/creds.json`;
          const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
          const sessionId = new URL(mega_url).pathname.split('/').pop();

          // Send session ID to user
          await sock.sendMessage(sock.user.id, { text: sessionId });
          
          // Close connection and cleanup
          await sock.ws.close();
          removeFile(`./temp/${id}`);
        }
      });
    } catch (err) {
      console.error("Error:", err);
      removeFile(`./temp/${id}`);
      res.status(500).json({ error: "Failed to generate session" });
    }
  }

  await MTEE_XMD_PAIR_CODE();
});