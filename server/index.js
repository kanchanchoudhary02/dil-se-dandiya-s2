
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import OfferEntry from './models/OfferEntry.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());

const allowedOrigins = [...new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  ...(process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
])];

function getRequestBody(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '20kb' }));

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateCode() {
  return randomBytes(3).toString('hex').slice(0, 5).toUpperCase();
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata'
  });
}

async function sendNotificationEmail(subject, html) {
  const {
    RESEND_API_KEY,
    RESEND_FROM,
    ADMIN_NOTIFICATION_EMAIL
  } = process.env;

  if (!RESEND_API_KEY || !RESEND_FROM || !ADMIN_NOTIFICATION_EMAIL) {
    console.warn(
      'Email skipped: configure RESEND_API_KEY, RESEND_FROM and ADMIN_NOTIFICATION_EMAIL.'
    );
    return;
  }

    const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
body: JSON.stringify({
      from: RESEND_FROM,
      to: [ADMIN_NOTIFICATION_EMAIL],
      subject,
      html
    })
  });

  if (!response.ok) {
    throw new Error(
      `Resend email failed (${response.status}): ${await response.text()}`
    );
  }
}

function notifyAdmin(subject, html) {
  sendNotificationEmail(subject, html).catch(error => {
    console.error('Email notification failed:', error.message);
  });
}

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Dil Se Dandiya API is running'
  });
});

const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many attempts. Please try again later.'
  }
});

// Submit offer form and save the entry in MongoDB.
app.post('/api/offers', submitLimiter, async (req, res, next) => {
  try {
    const body = getRequestBody(req);
    let name = String(body.name || '')
      .trim()
      .replace(/\s+/g, ' ');

    let phone = String(body.phone || '').replace(/\D/g, '');

    if (body.website) {
      return res.status(400).json({
        message: 'Unable to process this request.'
      });
    }

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        message: 'Please enter your full name.'
      });
    }

    if (phone.length === 12 && phone.startsWith('91')) {
      phone = phone.slice(2);
    }

    if (phone.length === 11 && phone.startsWith('0')) {
      phone = phone.slice(1);
    }

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({
        message: 'Please enter a valid 10-digit mobile number.'
      });
    }

    let entry = await OfferEntry.findOne({ phone });

    if (entry) {
      entry.visits = (entry.visits || 0) + 1;
      entry.lastSeen = new Date();
      entry.name = name;
      await entry.save();
    } else {
      let code;
      let unique = false;

      for (let i = 0; i < 10; i++) {
        code = `DSD2-${generateCode()}`;

        if (!(await OfferEntry.exists({ code }))) {
          unique = true;
          break;
        }
      }

      if (!unique) {
        return res.status(500).json({
          message: 'Unable to generate an offer code. Please try again.'
        });
      }

      entry = await OfferEntry.create({
        name,
        phone,
        code,
        visits: 1,
        ip: req.ip,
        createdAt: new Date(),
        lastSeen: new Date(),
        isScratched: false
      });
    }

    notifyAdmin(
      'New Dil Se Dandiya offer entry',
      `<h2>New offer entry</h2>
       <p><b>Name:</b> ${escapeHtml(entry.name)}</p>
       <p><b>Mobile:</b> ${escapeHtml(entry.phone)}</p>
       <p><b>Offer code:</b> ${escapeHtml(entry.code)}</p>
       <p><b>Visits:</b> ${entry.visits}</p>
       <p><b>Submitted at:</b> ${formatDate(entry.lastSeen)}</p>`
    );

    return res.json({
      success: true,
      user: {
        name: entry.name,
        code: entry.code,
        isScratched: Boolean(entry.isScratched),
        scratchResult: entry.scratchResult || null
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: 'An entry already exists. Please try again.'
      });
    }

    next(error);
  }
});

// Save the scratch result to the same MongoDB entry.
app.post('/api/offers/:code/scratch', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const entry = await OfferEntry.findOne({ code });

    if (!entry) {
      return res.status(404).json({
        success: false,
        message: 'Offer entry not found.'
      });
    }

    if (!entry.isScratched) {
      entry.isScratched = true;
      entry.scratchResult = 'Buy 2 Get 1 FREE';
      entry.scratchedAt = new Date();

      await entry.save();

      notifyAdmin(
        'Dil Se Dandiya scratch card revealed',
        `<h2>Scratch card revealed</h2>
         <p><b>Name:</b> ${escapeHtml(entry.name)}</p>
         <p><b>Mobile:</b> ${escapeHtml(entry.phone)}</p>
         <p><b>Offer code:</b> ${escapeHtml(entry.code)}</p>
         <p><b>Prize:</b> ${escapeHtml(entry.scratchResult)}</p>
         <p><b>Scratched at:</b> ${formatDate(entry.scratchedAt)}</p>`
      );
    }

    return res.json({
      success: true,
      isScratched: entry.isScratched,
      scratchResult: entry.scratchResult,
      scratchedAt: entry.scratchedAt
    });
  } catch (error) {
    next(error);
  }
});

// Admin login.
app.post(
  '/api/admin/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false
  }),
  (req, res) => {
    const body = getRequestBody(req);

    if (!process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) {
      return res.status(500).json({
        message: 'Admin authentication is not configured on the server.'
      });
    }

    if (String(body.password || '') !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({
        message: 'Incorrect password.'
      });
    }

    const token = jwt.sign(
      { role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({ token });
  }
);

function authenticateAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured.');
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.role !== 'admin') {
      throw new Error('Not an admin.');
    }

    next();
  } catch {
    return res.status(401).json({
      message: 'Your admin session has expired. Please log in again.'
    });
  }
}

// List and search entries.
app.get('/api/admin/entries', authenticateAdmin, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();

    const filter = q
      ? {
          $or: [
            { name: { $regex: escapeRegex(q), $options: 'i' } },
            { phone: { $regex: escapeRegex(q) } },
            { code: { $regex: escapeRegex(q), $options: 'i' } }
          ]
        }
      : {};

    const [entries, total, today] = await Promise.all([
      OfferEntry.find(filter)
        .sort({ createdAt: -1 })
        .limit(1000)
        .lean(),

      OfferEntry.countDocuments(),

      OfferEntry.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      })
    ]);

    return res.json({ entries, total, today });
  } catch (error) {
    next(error);
  }
});

// Export entries as CSV.
app.get('/api/admin/export', authenticateAdmin, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();

    const filter = q
      ? {
          $or: [
            { name: { $regex: escapeRegex(q), $options: 'i' } },
            { phone: { $regex: escapeRegex(q) } },
            { code: { $regex: escapeRegex(q), $options: 'i' } }
          ]
        }
      : {};

    const rows = await OfferEntry.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const cell = value =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;

    const header = [
      '#',
      'Name',
      'Mobile',
      'Offer code',
      'Visits',
      'Scratch status',
      'Scratch result',
      'Scratched at',
      'Entry time'
    ];

    const csv = [
      header.map(cell).join(','),
      ...rows.map((row, index) =>
        [
          rows.length - index,
          row.name,
          row.phone,
          row.code,
          row.visits,
          row.isScratched ? 'Scratched' : 'Not scratched',
          row.scratchResult || '',
          row.scratchedAt ? formatDate(row.scratchedAt) : '',
          formatDate(row.createdAt)
        ].map(cell).join(',')
      )
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="dil-se-dandiya-entries.csv"'
    );

    return res.send('\uFEFF' + csv);
  } catch (error) {
    next(error);
  }
});

// Handle application errors.
app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  if (error.message === 'Origin not allowed by CORS') {
    return res.status(403).json({
      message: 'This website origin is not allowed.'
    });
  }

  return res.status(500).json({
    message: 'Server error. Please check the database connection and server settings.'
  });
});

const port = process.env.PORT || 5000;

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is missing in server/.env');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    app.listen(port, () => {
      console.log(`API listening on port ${port}`);
      console.log('Allowed frontend origins:', allowedOrigins);
    });
  })
  .catch(error => {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  });

