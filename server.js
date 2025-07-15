const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

console.log('Connecting to MySQL with:', {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'call-app'
});
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'call-app'
});
// Test DB connection on startup
(async () => {
  try {
    await db.query('SELECT 1');
    console.log('MySQL connection successful.');
  } catch (err) {
    console.error('MySQL connection failed:', err);
  }
})();

const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

// Signup
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] Incoming request: ${req.method} ${req.url}`);
  next();
});

app.post('/register', async (req, res) => {
  const { name, email, password, avatar } = req.body;
  if (!(name && email && password)) return res.json({ success: false, message: 'Missing fields' });
  const hash = await bcrypt.hash(password, 10);
  try {
    // Insert user, avatar is optional
    const [result] = await db.query(
      'INSERT INTO users (name, email, password, avatar) VALUES (?, ?, ?, ?)',
      [name, email, hash, avatar || null]
    );
    // Fetch the newly created user
    const [rows] = await db.query('SELECT id, name, email, avatar, created_at FROM users WHERE id = ?', [result.insertId]);
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Register error:', err);
    let msg = 'Server error';
    if (err.code === 'ER_DUP_ENTRY') msg = 'Email already registered';
    res.json({ success: false, message: msg });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length) return res.json({ success: false, message: 'User not found' });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'Incorrect password' });
    // Generate a token
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.json({ success: false, message: 'Server error' });
  }
});

const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// WebRTC signaling logic
const rooms = {};

io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    socket.roomId = roomId;

    // Check if the room is full before joining
    if (rooms[roomId] && rooms[roomId].length >= 2) {
      socket.emit('room-full');
      return; // Prevent joining
    }

    if (!rooms[roomId]) rooms[roomId] = [];
    if (!rooms[roomId].includes(socket.id)) {
      rooms[roomId].push(socket.id);
    }

    socket.join(roomId);
    socket.emit('joined-room', roomId);

    // Notify others only if this is a second user
    if (rooms[roomId].length > 1) {
      socket.to(roomId).emit('peer-joined', socket.id);
    }
    console.log(`[Socket] ${socket.id} joined room ${roomId}`);
  });

  socket.on('leave-room', (roomId) => {
    console.log(`[Socket] ${socket.id} manually left room ${roomId}`);
    socket.leave(roomId);
    if (rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      socket.to(roomId).emit('peer-left', socket.id);

      if (rooms[roomId].length === 0) {
        delete rooms[roomId];
      }
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      socket.to(roomId).emit('peer-left', socket.id);

      if (rooms[roomId].length === 0) {
        delete rooms[roomId];
      }

      console.log(`[Socket] ${socket.id} disconnected from room ${roomId}`);
    }
  });

  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('reject-call', (roomId) => {
    socket.to(roomId).emit('call-rejected');
  });

  socket.on('hangup-call', (roomId) => {
    socket.to(roomId).emit('peer-left');   // reuse existing listener
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`API & signaling server running on port ${PORT}`));

// Get user profile by ID (authentication via token recommended)
app.get('/profile/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, avatar, created_at FROM users WHERE id = ?',
      [id]
    );
    if (!rows.length) return res.json({ success: false, message: 'User not found' });
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.json({ success: false, message: 'Server error' });
  }
});
