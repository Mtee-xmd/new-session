const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const __path = process.cwd();
const PORT = process.env.PORT || 8000;

let server = require('./qr');
let code = require('./pair');

require('events').EventEmitter.defaultMaxListeners = 500;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/server', server);
app.use('/code', code);

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__path, 'pair.html'));
});

app.get('/qr', (req, res) => {
  res.sendFile(path.join(__path, 'qr.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__path, 'main.html'));
});

app.listen(PORT, () => {
  console.log(`
Don't Forget To Give Star MTEE-XMD 
Server running on http://localhost:${PORT}`);
});

module.exports = app;