import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { userDb } from '../modules/database/index.js';
import { getConnection } from '../modules/database/connection.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const db = getConnection();

// Check auth status and setup requirements
router.get('/status', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();
    res.json({ 
      needsSetup: !hasUsers,
      isAuthenticated: false // Will be overridden by frontend if token exists
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User registration (setup) - only allowed if no users exist
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
    }
    
    // Use a transaction to prevent race conditions
    db.prepare('BEGIN').run();
    try {
      // Check if users already exist (only allow one user)
      const hasUsers = userDb.hasUsers();
      if (hasUsers) {
        db.prepare('ROLLBACK').run();
        return res.status(403).json({ error: 'User already exists. This is a single-user system.' });
      }
      
      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      
      // Create user
      const user = userDb.createUser(username, passwordHash);
      
      // Generate token
      const token = generateToken(user);
      
      db.prepare('COMMIT').run();

      // Update last login (non-fatal, outside transaction)
      userDb.updateLastLogin(user.id);

      res.json({
        success: true,
        user: { id: user.id, username: user.username },
        token
      });
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }
    
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

import os from 'os';

// LAN addresses of this desktop, for the mobile QR pairing payload.
router.get('/lan-info', authenticateToken, (req, res) => {
    try {
        const ips = new Set();
        for (const addrs of Object.values(os.networkInterfaces())) {
            for (const addr of addrs ?? []) {
                if (addr.family === 'IPv4' && !addr.internal) ips.add(addr.address);
            }
        }
        const port = Number(process.env.SERVER_PORT || 3001);
        res.json({ success: true, ips: [...ips], port });
    } catch (error) {
        console.error('LAN info error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// One-time device pairing tokens (mobile QR connect).
// Tokens live in memory for PAIRING_TTL_MS (5 min), single use. Desktop never
// puts the account password in a QR code — the phone exchanges the pairing
// token for a normal JWT via POST /api/auth/pair/exchange.
const pairingTokens = new Map(); // token -> { userId, username, expiresAt }
const PAIRING_TTL_MS = 5 * 60 * 1000;

function cleanExpiredPairingTokens() {
    const now = Date.now();
    for (const [k, v] of pairingTokens) {
        if (v.expiresAt <= now) pairingTokens.delete(k);
    }
}

// Create a pairing token (requires an authenticated desktop session).
router.post('/pair/create', authenticateToken, (req, res) => {
    try {
        cleanExpiredPairingTokens();
        const token = crypto.randomBytes(24).toString('base64url');
        pairingTokens.set(token, {
            userId: req.user.id,
            username: req.user.username,
            expiresAt: Date.now() + PAIRING_TTL_MS,
        });
        res.json({ success: true, token, expiresInMs: PAIRING_TTL_MS });
    } catch (error) {
        console.error('Pair create error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Exchange a pairing token for a normal JWT (no auth — the pairing token IS
// the credential; single use + short TTL limit a leaked token's value).
router.post('/pair/exchange', (req, res) => {
    try {
        cleanExpiredPairingTokens();
        const { token } = req.body || {};
        if (!token) return res.status(400).json({ error: 'token required' });
        const entry = pairingTokens.get(String(token));
        if (!entry || entry.expiresAt <= Date.now()) {
            pairingTokens.delete(String(token));
            return res.status(401).json({ error: 'Invalid or expired pairing token' });
        }
        // Single use.
        pairingTokens.delete(String(token));
        const user = userDb.getUserById(entry.userId);
        if (!user) return res.status(401).json({ error: 'User not found' });
        const jwt = generateToken(user);
        userDb.updateLastLogin(user.id);
        res.json({
            success: true,
            user: { id: user.id, username: user.username },
            token: jwt,
        });
    } catch (error) {
        console.error('Pair exchange error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user from database
    const user = userDb.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate token
    const token = generateToken(user);
    
    // Update last login
    userDb.updateLastLogin(user.id);
    
    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  // In a simple JWT system, logout is mainly client-side
  // This endpoint exists for consistency and potential future logging
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
