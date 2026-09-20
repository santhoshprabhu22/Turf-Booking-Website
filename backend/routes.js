import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { SMSService } from './smsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure Multer for screenshot uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'payment-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Helper: Calculate slot price based on time block
// Daytime slots (starting before 18:00 / 6:00 PM) cost 900.
// Evening slots (starting at or after 18:00 / 6:00 PM) cost 1300.
function getSlotPrice(timeString) {
  const hour = parseInt(timeString.split(':')[0], 10);
  return hour >= 18 ? 1300 : 900;
}

// Helper: Standard slots layout starting at 06:00 AM with a 15-minute gap
const STANDARD_SLOTS = [
  '06:00 - 07:00',
  '07:15 - 08:15',
  '08:30 - 09:30',
  '09:45 - 10:45',
  '11:00 - 12:00',
  '12:15 - 13:15',
  '13:30 - 14:30',
  '14:45 - 15:45',
  '16:00 - 17:00',
  '17:15 - 18:15',
  '18:30 - 19:30',
  '19:45 - 20:45',
  '21:00 - 22:00',
  '22:15 - 23:15'
];

// Helper: Clean up expired holds
async function cleanExpiredHolds() {
  const now = Date.now();
  const holdExpiryWindow = 10 * 60 * 1000; // 10 minutes hold
  await db.delete('holds', item => (now - item.heldAt) > holdExpiryWindow);
}

// ============================================================
// AUTHENTICATION ROUTES
// ============================================================

// ── STEP 1: Enter email address → OTP sent to that email ─────
router.post('/auth/send-otp', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const result = await SMSService.sendOTP(cleanEmail);

  if (!result.success) {
    return res.status(500).json({ success: false, message: result.message });
  }

  return res.json({
    success: true,
    message: result.message,
    // Only returned in sandbox mode (when EMAIL_FROM is not set in .env)
    ...(result.otp ? { otp: result.otp } : {})
  });
});

// ── STEP 2: Enter OTP → verify → logged in (auto-create account) ──
router.post('/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  const verification = await SMSService.verifyOTP(cleanEmail, otp);
  if (!verification.success) {
    return res.status(400).json({ success: false, message: verification.message });
  }

  // Find existing user by email, or create new account automatically
  let user = await db.findOne('users', u => u.email?.toLowerCase() === cleanEmail);
  if (!user) {
    user = await db.insert('users', {
      name: cleanEmail.split('@')[0], // Use part before @ as default name
      mobile: '',
      email: cleanEmail,
      isAdmin: false
    });
  }

  const { passwordHash, ...safeUser } = user;
  return res.json({ success: true, message: 'Logged in successfully!', user: safeUser });
});

// ── ADMIN LOGIN ───────────────────────────────────────────────
router.post('/auth/admin-login', async (req, res) => {
  const { username, password } = req.body;
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'turfadmin123';

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      user: { id: 'admin-user-id', name: 'Turf Owner', mobile: '9999999999', email: 'owner@santhoshturf.com', isAdmin: true }
    });
  }
  return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
});



// ----------------------------------------------------
// SLOTS MANAGEMENT
// ----------------------------------------------------

// Get Availability for a Date
router.get('/slots', async (req, res) => {
  const { date, userId } = req.query;

  if (!date) {
    return res.status(400).json({ success: false, message: 'Date parameter is required (YYYY-MM-DD)' });
  }

  await cleanExpiredHolds();

  const bookings = await db.getCollection('bookings');
  const holds = await db.getCollection('holds');

  const now = Date.now();
  const holdExpiryWindow = 10 * 60 * 1000;

  // Build current slots statuses
  const slotsList = STANDARD_SLOTS.map(timeRange => {
    const price = getSlotPrice(timeRange);
    
    // Check if slot has a confirmed or pending booking
    const booking = bookings.find(b => b.slotDate === date && b.slotTime.split(', ').includes(timeRange) && b.status !== 'cancelled');
    
    // Check if slot is held
    const hold = holds.find(h => h.slotDate === date && h.slotTime === timeRange);
    
    let status = 'available';
    let heldBy = null;
    let expiresIn = 0;
    let bookingId = null;

    if (booking) {
      status = 'booked';
      bookingId = booking.id;
    } else if (hold) {
      const elapsed = now - hold.heldAt;
      if (elapsed < holdExpiryWindow) {
        heldBy = hold.userId;
        expiresIn = Math.max(0, Math.floor((holdExpiryWindow - elapsed) / 1000));
        status = hold.userId === userId ? 'held_by_me' : 'held';
      }
    }

    return {
      time: timeRange,
      price,
      status,
      heldBy,
      expiresIn,
      bookingId
    };
  });

  return res.json({ success: true, date, slots: slotsList });
});

// Hold a Slot (10-minute hold lock)
router.post('/slots/hold', async (req, res) => {
  const { slotDate, slotTime, userId } = req.body;

  if (!slotDate || !slotTime || !userId) {
    return res.status(400).json({ success: false, message: 'Missing hold details' });
  }

  await cleanExpiredHolds();

  // Check if already booked
  const booking = await db.findOne('bookings', b => 
    b.slotDate === slotDate && b.slotTime.split(', ').includes(slotTime) && b.status !== 'cancelled'
  );
  if (booking) {
    return res.status(400).json({ success: false, message: 'This slot is already booked.' });
  }

  // Check if held by someone else
  const hold = await db.findOne('holds', h => 
    h.slotDate === slotDate && h.slotTime === slotTime
  );
  if (hold && hold.userId !== userId) {
    return res.status(400).json({ success: false, message: 'This slot is currently held by another customer.' });
  }

  // Create hold (or refresh if already held by me) — multiple holds allowed
  if (hold && hold.userId === userId) {
    await db.update('holds', hold.id, { heldAt: Date.now() });
  } else {
    await db.insert('holds', {
      slotDate,
      slotTime,
      userId,
      heldAt: Date.now()
    });
  }

  return res.json({ success: true, message: 'Slot hold lock secured for 10 minutes.' });
});

// Release a Slot
router.post('/slots/release', async (req, res) => {
  const { slotDate, slotTime, userId } = req.body;

  if (!slotDate || !slotTime || !userId) {
    return res.status(400).json({ success: false, message: 'Missing release details' });
  }

  await db.delete('holds', h => h.slotDate === slotDate && h.slotTime === slotTime && h.userId === userId);
  return res.json({ success: true, message: 'Slot released successfully.' });
});

// ----------------------------------------------------
// BOOKINGS MANAGEMENT
// ----------------------------------------------------

// Submit Booking with Manual Screenshot / UTR code
router.post('/bookings', upload.single('screenshot'), async (req, res) => {
  const { userId, slotDate, slotTime, utrNumber, amount } = req.body;
  const screenshotFile = req.file;

  if (!userId || !slotDate || !slotTime || !amount) {
    return res.status(400).json({ success: false, message: 'Missing booking details' });
  }

  if (!utrNumber && !screenshotFile) {
    return res.status(400).json({ success: false, message: 'Payment screenshot or UTR number is required.' });
  }

  // Verify slots are not already booked
  const requestedSlots = slotTime.split(', ');
  const existingBooking = await db.findOne('bookings', b => 
    b.slotDate === slotDate && 
    b.slotTime.split(', ').some(t => requestedSlots.includes(t)) && 
    b.status !== 'cancelled'
  );
  if (existingBooking) {
    return res.status(400).json({ success: false, message: 'One or more of selected slots are already booked.' });
  }

  // Get user details
  const user = await db.findOne('users', u => u.id === userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const screenshotUrl = screenshotFile ? `/uploads/${screenshotFile.filename}` : null;

  // Create Booking in pending_payment status
  const booking = await db.insert('bookings', {
    userId,
    userName: user.name,
    userMobile: user.mobile,
    userEmail: user.email,
    slotDate,
    slotTime,
    amount: parseFloat(amount),
    status: 'pending_payment',
    utrNumber: utrNumber || '',
    screenshotUrl,
    refundProcessed: false
  });

  // Release holds for all booked slots
  await db.delete('holds', h => h.slotDate === slotDate && requestedSlots.includes(h.slotTime) && h.userId === userId);

  // Send admin notification
  await db.insert('notifications', {
    type: 'new_booking',
    title: 'New Slot Booking Request',
    message: `${user.name} (${user.mobile}) has booked slot ${slotTime} on ${slotDate}. Payment review pending.`,
    status: 'unread'
  });

  console.log(`[NOTIFY OWNER] New Booking Request: User ${user.name} booked ${slotTime} on ${slotDate}. Amount ₹${amount}. UTR: ${utrNumber || 'None'}`);

  return res.json({ success: true, message: 'Booking submitted successfully. Awaiting payment verification.', booking });
});

// Get My Bookings
router.get('/my-bookings', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  const bookings = await db.find('bookings', b => b.userId === userId);
  // Sort by created date descending
  bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return res.json({ success: true, bookings });
});

// Cancel Booking (Refund eligibility logic: 3 hours before start time)
router.post('/bookings/cancel', async (req, res) => {
  const { bookingId, userId } = req.body;

  if (!bookingId || !userId) {
    return res.status(400).json({ success: false, message: 'Booking ID and User ID are required.' });
  }

  const booking = await db.findOne('bookings', b => b.id === bookingId && b.userId === userId);
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  if (booking.status === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Booking is already cancelled.' });
  }

  // Calculate cancellation window (3 hours before slot starts - using the earliest slot)
  const earliestSlot = booking.slotTime.split(', ')[0];
  const [startTimeStr] = earliestSlot.split(' - ');
  const [hours, minutes] = startTimeStr.split(':').map(Number);
  
  const slotDateTime = new Date(booking.slotDate);
  slotDateTime.setHours(hours, minutes, 0, 0);

  const now = Date.now();
  const timeDifferenceMs = slotDateTime.getTime() - now;
  const hoursRemaining = timeDifferenceMs / (1000 * 60 * 60);

  let refundEligible = false;
  let message = '';

  if (hoursRemaining >= 3) {
    refundEligible = true;
    message = 'Booking cancelled successfully. You are eligible for a 50% refund.';
  } else {
    message = 'Booking cancelled successfully. Refund is not eligible because cancellation was requested less than 3 hours before the slot.';
  }

  // Cancel booking
  const updatedBooking = await db.update('bookings', bookingId, {
    status: 'cancelled',
    refundProcessed: false,
    refundEligibility: refundEligible ? '50_percent' : 'none'
  });

  // Notify Admin
  await db.insert('notifications', {
    type: 'cancelled_booking',
    title: 'Booking Cancelled by Customer',
    message: `${booking.userName} cancelled slot ${booking.slotTime} on ${booking.slotDate}. Refund: ${refundEligible ? '50%' : 'None'}`,
    status: 'unread'
  });

  return res.json({ 
    success: true, 
    message, 
    booking: updatedBooking 
  });
});

// ----------------------------------------------------
// OWNER / ADMIN ENDPOINTS
// ----------------------------------------------------

// Admin - Get Dashboard Stats and Bookings
router.get('/admin/bookings', async (req, res) => {
  const { secret } = req.query;
  
  // Quick security check (normally would use JWT verify)
  if (secret !== 'admin-secret-token') {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  const bookings = await db.getCollection('bookings');
  bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const notifications = await db.getCollection('notifications');
  notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return res.json({ success: true, bookings, notifications });
});

// Admin - Perform booking actions (Approve, Reject, Refund, Cancel)
router.post('/admin/bookings/action', async (req, res) => {
  const { secret, bookingId, action } = req.body;

  if (secret !== 'admin-secret-token') {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  const booking = await db.findOne('bookings', b => b.id === bookingId);
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  let updates = {};
  let notifyMsg = '';

  if (action === 'approve') {
    updates = { status: 'confirmed' };
    notifyMsg = `Admin approved payment for slot ${booking.slotTime} on ${booking.slotDate}.`;
    console.log(`[SMS NOTIFY CUSTOMER] Booking Confirmed: Your slot for ${booking.slotDate} at ${booking.slotTime} has been booked!`);
  } else if (action === 'reject') {
    updates = { status: 'cancelled', refundEligibility: 'none' };
    notifyMsg = `Admin rejected payment screenshot for slot ${booking.slotTime} on ${booking.slotDate}.`;
  } else if (action === 'refund') {
    updates = { refundProcessed: true };
    notifyMsg = `Admin processed 50% cashback refund of ₹${(booking.amount / 2).toFixed(2)} for ${booking.userName}.`;
    console.log(`[SMS NOTIFY CUSTOMER] Refund Processed: Your 50% cashback of ₹${(booking.amount / 2).toFixed(2)} is processed!`);
  } else if (action === 'cancel') {
    // Admin manual cancellation overrides
    updates = { status: 'cancelled', refundEligibility: '50_percent' };
    notifyMsg = `Admin manually cancelled booking for ${booking.userName}.`;
  } else {
    return res.status(400).json({ success: false, message: 'Invalid action.' });
  }

  const updatedBooking = await db.update('bookings', bookingId, updates);

  // Read notifications, mark as read, or add actions log
  await db.insert('notifications', {
    type: 'admin_action',
    title: 'Booking Action Logged',
    message: notifyMsg,
    status: 'read'
  });

  return res.json({ success: true, message: 'Action processed successfully.', booking: updatedBooking });
});

// Admin - Clear Notifications
router.post('/admin/notifications/clear', async (req, res) => {
  const { secret } = req.body;
  if (secret !== 'admin-secret-token') {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  const notifications = await db.getCollection('notifications');
  for (const n of notifications) {
    await db.update('notifications', n.id, { status: 'read' });
  }

  return res.json({ success: true, message: 'Notifications cleared.' });
});

export default router;
