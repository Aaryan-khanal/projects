const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(__dirname));

const port = Number(process.env.PORT || 3000);
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'nirikshan_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'superadmin' || value === 'super_admin' || value === 'super-admin') return 'super_admin';
  if (value === 'admin') return 'admin';
  if (value === 'teacher') return 'teacher';
  if (value === 'student') return 'student';
  return 'teacher';
}

function buildUserPayload(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    studentId: row.student_id,
    photoDataUrl: row.photo_data_url || null,
    status: row.status
  };
}

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(poolConfig);
  }
  return pool;
}

async function ensureSchema() {
  const connection = await getPool();
  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) DEFAULT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      student_id VARCHAR(100) DEFAULT NULL,
      photo_data_url TEXT DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_student_id (student_id)
    )
  `);

  try {
    await connection.query('ALTER TABLE users ADD COLUMN photo_data_url TEXT DEFAULT NULL');
  } catch (err) {
    if (err && err.code !== 'ER_DUP_FIELDNAME') throw err;
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      student_id VARCHAR(100) DEFAULT NULL,
      student_name VARCHAR(255) DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'present',
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
}

async function seedDefaultUsers() {
  const connection = await getPool();
  const superAdminPassword = (process.env.SUPER_ADMIN_PASSWORD || 'superadmin').trim();
  const adminPassword = (process.env.ADMIN_PASSWORD || 'admin').trim();
  const superAdminHash = await bcrypt.hash(superAdminPassword, 10);
  const adminHash = await bcrypt.hash(adminPassword, 10);

  const [rows] = await connection.query(
    'SELECT id, email, role FROM users WHERE email IN (?, ?) LIMIT 2',
    ['superadmin', 'admin']
  );

  const superAdminRow = rows.find(row => String(row.email).toLowerCase() === 'superadmin');
  const adminRow = rows.find(row => String(row.email).toLowerCase() === 'admin');

  if (!superAdminRow) {
    await connection.query(
      'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
      ['Super Admin', 'superadmin', superAdminHash, 'super_admin', 'active']
    );
  } else {
    await connection.query(
      'UPDATE users SET password_hash = ?, role = ?, status = ? WHERE id = ?',
      [superAdminHash, 'super_admin', 'active', superAdminRow.id]
    );
  }

  if (!adminRow) {
    await connection.query(
      'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
      ['Admin', 'admin', adminHash, 'admin', 'active']
    );
  } else {
    await connection.query(
      'UPDATE users SET password_hash = ?, role = ?, status = ? WHERE id = ?',
      [adminHash, 'admin', 'active', adminRow.id]
    );
  }
}

async function createSession(userId) {
  const connection = await getPool();
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 8); // 8 hours
  await connection.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [userId, tokenHash, expiresAt]);
  return token;
}

async function verifySessionToken(token) {
  if (!token) return null;
  const connection = await getPool();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const [rows] = await connection.query(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > NOW() LIMIT 1`,
    [tokenHash]
  );
  if (rows.length === 0) return null;
  return rows[0];
}

async function removeSession(token) {
  if (!token) return;
  const connection = await getPool();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await connection.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
}

app.get('/health', async (_req, res) => {
  try {
    const connection = await getPool();
    await connection.query('SELECT 1 + 1 AS result');
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, studentId, role } = req.body || {};
    const normalizedRole = normalizeRole(role);
    const connection = await getPool();

    let userRow = null;
    if (normalizedRole === 'student') {
      const [rows] = await connection.query('SELECT * FROM users WHERE role = ? AND student_id = ? AND status = ? LIMIT 1', ['student', studentId, 'active']);
      userRow = rows[0];
    } else {
      const [rows] = await connection.query('SELECT * FROM users WHERE role IN (?, ?, ?) AND email = ? AND status = ? LIMIT 1', ['super_admin', 'admin', 'teacher', email, 'active']);
      userRow = rows[0];
    }

    if (!userRow && (email || '').trim().toLowerCase() === 'superadmin') {
      await seedDefaultUsers();
      const [rows] = await connection.query('SELECT * FROM users WHERE role IN (?, ?, ?) AND email = ? AND status = ? LIMIT 1', ['super_admin', 'admin', 'teacher', email, 'active']);
      userRow = rows[0];
    }

    if (!userRow) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordOk = await bcrypt.compare(password || '', userRow.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = await createSession(userRow.id);
    res.json({ token, user: buildUserPayload(userRow) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token || '';
    const user = await verifySessionToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    res.json({ user: buildUserPayload(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Authentication middleware ---
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.replace('Bearer ', '') || req.query.token || (req.body && req.body.token);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const user = await verifySessionToken(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = buildUserPayload(user);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const userRole = (req.user && req.user.role) || '';
    if (Array.isArray(role)) {
      if (!role.includes(userRole)) return res.status(403).json({ error: 'Forbidden' });
    } else {
      if (userRole !== role) return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.body?.token || '';
    await removeSession(token);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', authMiddleware, requireRole('super_admin'), async (_req, res) => {
  try {
    const connection = await getPool();
    const [rows] = await connection.query('SELECT id, name, email, role, student_id AS studentId, photo_data_url AS photoDataUrl, status, created_at AS createdAt FROM users ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', authMiddleware, requireRole('super_admin'), async (req, res) => {
  try {
    const { name, email, password, role, studentId, photoDataUrl } = req.body || {};
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password and role are required' });
    }
    const normalizedRole = normalizeRole(role);
    const passwordHash = await bcrypt.hash(password, 10);
    const connection = await getPool();
    const [result] = await connection.query(
      'INSERT INTO users (name, email, password_hash, role, student_id, photo_data_url, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, email, passwordHash, normalizedRole, studentId || null, photoDataUrl || null, 'active']
    );
    res.json({ ok: true, user: { id: result.insertId, name, email, role: normalizedRole, studentId: studentId || null, photoDataUrl: photoDataUrl || null, status: 'active' } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users/:id', authMiddleware, requireRole('super_admin'), async (req, res) => {
  try {
    const connection = await getPool();
    await connection.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/attendance', authMiddleware, async (_req, res) => {
  try {
    const connection = await getPool();
    const [rows] = await connection.query('SELECT * FROM attendance_records ORDER BY recorded_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/attendance', authMiddleware, async (req, res) => {
  try {
    const { studentId, studentName, status } = req.body || {};
    const userId = req.user && req.user.id;
    const connection = await getPool();
    const [result] = await connection.query(
      'INSERT INTO attendance_records (user_id, student_id, student_name, status) VALUES (?, ?, ?, ?)',
      [userId || null, studentId || null, studentName || null, status || 'present']
    );
    res.json({ ok: true, id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

(async function bootstrap() {
  try {
    await ensureSchema();
    await seedDefaultUsers();
    app.listen(port, () => {
      console.log(`Nirikshan server listening on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();
