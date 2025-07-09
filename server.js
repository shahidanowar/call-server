const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '', // your mysql root password
  database: 'call-app'
});

const JWT_SECRET = 'your_secret_key';

// Signup
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
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// WebRTC signaling logic
const rooms = {};

io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    if (!rooms[roomId]) rooms[roomId] = [];
    if (rooms[roomId].length >= 2) {
      socket.emit('room-full');
      return;
    }
    rooms[roomId].push(socket.id);
    socket.join(roomId);
    socket.emit('joined-room', roomId);
    socket.to(roomId).emit('peer-joined', socket.id);

    socket.on('signal', ({ to, data }) => {
      io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('disconnect', () => {
      rooms[roomId] = (rooms[roomId] || []).filter(id => id !== socket.id);
      socket.to(roomId).emit('peer-left', socket.id);
      if (rooms[roomId] && rooms[roomId].length === 0) delete rooms[roomId];
    });
  });
});

http.listen(3000, () => console.log('API & signaling running on http://10.236.159.54:3000'));

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