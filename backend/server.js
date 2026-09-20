import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import router from './routes.js';
import { db } from './db.js';

// Resolve __dirname first so we can pass an explicit .env path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the project root .env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: '*', // Allow all origins for dev simplicity
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static payment screenshot uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Use Express router
app.use('/api', router);

// Serve frontend in production
const frontendBuildPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendBuildPath));

// Fallback to React index.html for client-side routing
app.get('*', (req, res) => {
  // If request starts with /api, return 404, don't serve html
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found' });
  }
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

// Periodic hold check to clear locks automatically
setInterval(async () => {
  const now = Date.now();
  const holdExpiryWindow = 10 * 60 * 1000; // 10 minutes hold
  try {
    const deleted = await db.delete('holds', item => (now - item.heldAt) > holdExpiryWindow);
    if (deleted) {
      console.log('[HOLD CHECK] Cleaned up expired slot locks.');
    }
  } catch (err) {
    console.error('Error cleaning up holds in background:', err);
  }
}, 10000); // Check every 10 seconds

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  SANTHOSH TURF SERVER STARTED`);
  console.log(`  Running on: http://localhost:${PORT}`);
  console.log(`  Database path: ${path.join(__dirname, 'data', 'db.json')}`);
  console.log(`======================================================\n`);
});
