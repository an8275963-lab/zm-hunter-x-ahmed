const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

let sock = null;
let status = 'disconnected';
let qrDataUrl = null;
let pairingCode = null;
let lastError = '';
let reconnecting = false;
let botSettings = { antiLink: true, welcome: true, warnLimit: 3 };
const warnings = new Map();

function authMiddleware(req, res, next) {
  // Set DASHBOARD_PASSWORD in hosting environment for a private dashboard.
  if (!DASHBOARD_PASSWORD) return next();
  const supplied = req.headers['x-dashboard-password'] || req.query.password || '';
  if (supplied !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Dashboard password required.' });
  next();
}

function hasLink(text) {
  if (!text) return false;
  const urlPattern = /(?:https?:\/\/|www\.)\S+|(?:^|\s)(?:[a-z0-9-]+\.)+(?:com|net|org|gg|me|io|tv|app|co|uk|it|pk|ly|to|site|online|xyz|info|dev|ai|live|shop|store|cloud|link|cc|mobi|vip|pro|fun|top|tech|edu|gov)(?:\/\S*)?/i;
  return urlPattern.test(text);
}

function extractText(message) {
  const m = message?.message || {};
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || m.buttonsResponseMessage?.selectedDisplayText
    || m.listResponseMessage?.title
    || '';
}

async function isGroupAdmin(jid, participant) {
  try {
    const metadata = await sock.groupMetadata(jid);
    const person = metadata.participants.find(p => p.id === participant || p.phoneNumber === participant);
    return !!person && (person.admin === 'admin' || person.admin === 'superadmin');
  } catch (_) {
    return false;
  }
}

async function startWhatsApp() {
  if (reconnecting) return;
  reconnecting = true;
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch (_) {}
    sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: ['ZM HUNTER X AHMED', 'Chrome', '1.0.0'],
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        try { qrDataUrl = await QRCode.toDataURL(qr); } catch (_) { qrDataUrl = null; }
        pairingCode = null;
        status = 'waiting_for_qr';
      }
      if (connection === 'connecting') status = 'connecting';
      if (connection === 'open') {
        status = 'connected';
        qrDataUrl = null;
        pairingCode = null;
        lastError = '';
      }
      if (connection === 'close') {
        status = 'disconnected';
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) {
          setTimeout(() => { reconnecting = false; startWhatsApp(); }, 2500);
          return;
        }
        lastError = 'WhatsApp session logged out. Clear the session folder and reconnect.';
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !sock) return;
      for (const msg of messages) {
        try {
          const jid = msg.key?.remoteJid;
          const sender = msg.key?.participant || msg.key?.remoteJid;
          if (!jid || !jid.endsWith('@g.us') || msg.key?.fromMe) continue;

          const text = extractText(msg);
          const senderIsAdmin = await isGroupAdmin(jid, sender);

          // Admins can configure the bot; commands are only honored from group admins.
          if (senderIsAdmin && text) {
            const command = text.trim().toLowerCase();
            if (command === '.antilink on') {
              botSettings.antiLink = true;
              await sock.sendMessage(jid, { text: '🔗 Anti-link is ON.' });
              continue;
            }
            if (command === '.antilink off') {
              botSettings.antiLink = false;
              await sock.sendMessage(jid, { text: '🔗 Anti-link is OFF.' });
              continue;
            }
            if (command === '.welcome on') {
              botSettings.welcome = true;
              await sock.sendMessage(jid, { text: '👋 Welcome messages are ON.' });
              continue;
            }
            if (command === '.welcome off') {
              botSettings.welcome = false;
              await sock.sendMessage(jid, { text: '👋 Welcome messages are OFF.' });
              continue;
            }
            if (command === '.menu') {
              await sock.sendMessage(jid, { text:
                '👑 ZM HUNTER X AHMED\\n\\n.menu — commands\\n.ping — check bot\\n.alive — status\\n.antilink on/off — link protection\\n.welcome on/off — welcome messages\\n.rules — group rules\\n\\nBot must be a group admin to delete messages.' });
              continue;
            }
            if (command === '.ping') {
              await sock.sendMessage(jid, { text: '🏓 Pong! ZM HUNTER X AHMED is online.' });
              continue;
            }
            if (command === '.alive') {
              await sock.sendMessage(jid, { text: '✅ ZM HUNTER X AHMED is alive.' });
              continue;
            }
            if (command === '.rules') {
              await sock.sendMessage(jid, { text: '📜 Group rules: no unwanted links, spam, or abuse. Follow the admins.' });
              continue;
            }
          }

          if (botSettings.antiLink && !senderIsAdmin && hasLink(text)) {
            // WhatsApp only allows deleting others' messages when the bot account is a group admin.
            await sock.sendMessage(jid, { delete: msg.key });
            const key = `${jid}:${sender}`;
            const count = (warnings.get(key) || 0) + 1;
            warnings.set(key, count);
            await sock.sendMessage(jid, { text: `⚠️ @${String(sender).split('@')[0]} links are not allowed here. Warning ${count}/${botSettings.warnLimit}.`, mentions: [sender] });
          }
        } catch (err) {
          console.error('Message handler error:', err?.message || err);
        }
      }
    });
  } catch (err) {
    status = 'error';
    lastError = err?.message || String(err);
    console.error('WhatsApp startup error:', lastError);
  } finally {
    reconnecting = false;
  }
}

app.get('/api/status', authMiddleware, (_req, res) => {
  res.json({ status, qr: qrDataUrl, pairingCode, lastError, settings: botSettings });
});

app.post('/api/pairing-code', authMiddleware, async (req, res) => {
  try {
    if (!sock) return res.status(503).json({ error: 'WhatsApp is starting. Wait a few seconds and retry.' });
    if (status === 'connected') return res.status(400).json({ error: 'Already connected.' });
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    if (phone.length < 8 || phone.length > 15) return res.status(400).json({ error: 'Enter phone number with country code, digits only. Example: 393331234567' });
    if (!sock.authState?.creds?.registered) {
      pairingCode = await sock.requestPairingCode(phone);
      qrDataUrl = null;
      status = 'waiting_for_pairing_code';
      return res.json({ pairingCode, status });
    }
    return res.status(400).json({ error: 'This WhatsApp session is already registered. Log out/reset session before pairing another number.' });
  } catch (err) {
    lastError = err?.message || String(err);
    res.status(500).json({ error: 'Could not create pairing code. Check server logs and try again.' });
  }
});

app.post('/api/settings', authMiddleware, (req, res) => {
  const { antiLink, welcome } = req.body || {};
  if (typeof antiLink === 'boolean') botSettings.antiLink = antiLink;
  if (typeof welcome === 'boolean') botSettings.welcome = welcome;
  res.json({ settings: botSettings });
});

app.get('/health', (_req, res) => res.json({ ok: true, app: 'ZM HUNTER X AHMED' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ZM HUNTER X AHMED dashboard listening on port ${PORT}`);
  startWhatsApp();
});
