import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar, Clock, User, CheckCircle, AlertTriangle,
  Upload, List, DollarSign, ShieldAlert,
  RefreshCw, LogOut, Sparkles, Phone, Plus, Trash2, ShoppingCart, Key
} from 'lucide-react';

const API_BASE = '/api';

export default function App() {

  // ── CHANGE 1: Login page is ALWAYS the first page shown ─────
  const [user, setUser] = useState(null);
  const [currentView, setCurrentView] = useState('login');

  // Auth steps: 'email' (enter address) → 'otp' (enter code)
  const [authStep, setAuthStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [sandboxOtp, setSandboxOtp] = useState(''); // only shown when EMAIL_FROM not set in .env
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);


  // ── CHANGE 3: Multi-slot — array of held slots ───────────────
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [slots, setSlots] = useState([]);
  const [heldSlots, setHeldSlots] = useState([]); // ALL slots the user has held
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const pollRef = useRef(null);

  // ── Payment ──────────────────────────────────────────────────
  const [paymentForm, setPaymentForm] = useState({ utrNumber: '', screenshot: null, agreedToTerms: false });
  const [uploadingPayment, setUploadingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [lastBooking, setLastBooking] = useState(null);

  // ── My Bookings ──────────────────────────────────────────────
  const [myBookings, setMyBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // ── Admin ────────────────────────────────────────────────────
  const [adminCreds, setAdminCreds] = useState({ username: '', password: '' });
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('admin_token') || '');
  const [adminStats, setAdminStats] = useState({ totalBookings: 0, pendingBookings: 0, totalRevenue: 0 });
  const [adminBookings, setAdminBookings] = useState([]);
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [adminFilter, setAdminFilter] = useState('all');
  const [adminError, setAdminError] = useState('');
  const [showAdminModal, setShowAdminModal] = useState(false);

  const totalAmount = heldSlots.reduce((s, slot) => s + (slot.price || 0), 0);

  // ─────────────────────────────────────────────────────────────
  // SLOT POLLING (every 3 seconds)
  // ─────────────────────────────────────────────────────────────
  const fetchSlots = async (silent = false) => {
    if (!user) return;
    if (!silent) setLoadingSlots(true);
    try {
      const res = await fetch(`${API_BASE}/slots?date=${selectedDate}&userId=${user.id}`);
      const data = await res.json();
      if (data.success) {
        setSlots(data.slots);
        setHeldSlots(data.slots.filter(s => s.status === 'held_by_me'));
        setSlotsError('');
      } else { setSlotsError(data.message || 'Failed to load slots'); }
    } catch { setSlotsError('Connection error. Is the server running?'); }
    finally { if (!silent) setLoadingSlots(false); }
  };

  useEffect(() => {
    if (user && currentView === 'slots') {
      fetchSlots();
      pollRef.current = setInterval(() => fetchSlots(true), 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedDate, user, currentView]);

  // OTP resend countdown
  useEffect(() => {
    if (otpCountdown > 0) {
      const t = setTimeout(() => setOtpCountdown(c => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [otpCountdown]);

  // ─────────────────────────────────────────────────────────────
  // AUTH — Step 1: Enter email → OTP sent to that email
  // ─────────────────────────────────────────────────────────────
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!email || !email.includes('@')) {
      setAuthError('Please enter a valid email address.');
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = await res.json();
      if (data.success) {
        setAuthStep('otp');
        setOtpCountdown(60);
        setSandboxOtp(data.otp || ''); // only when EMAIL_FROM not configured in .env
      } else {
        setAuthError(data.message || 'Failed to send OTP. Please try again.');
      }
    } catch {
      setAuthError('Cannot connect to server. Make sure it is running.');
    } finally {
      setAuthLoading(false);
    }
  };

  // AUTH — Step 2: Enter OTP → verify → enter website
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (otpCode.length < 6) {
      setAuthError('Please enter the 6-digit OTP.');
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otpCode })
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        localStorage.setItem('turf_user', JSON.stringify(data.user));
        setCurrentView('slots');
        setSandboxOtp('');
        setOtpCode('');
        setEmail('');
        setAuthStep('email');
      } else {
        setAuthError(data.message || 'Incorrect OTP. Try again.');
      }
    } catch {
      setAuthError('Cannot connect to server. Make sure it is running.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('turf_user');
    setHeldSlots([]);
    setCurrentView('login');
    setAuthStep('email');
    setEmail('');
    setOtpCode('');
  };


  // ─────────────────────────────────────────────────────────────
  // CHANGE 3: MULTI-SLOT — click to hold, click again to release
  // ─────────────────────────────────────────────────────────────
  const handleSlotClick = async (slot) => {
    if (!user) { setCurrentView('login'); return; }
    if (slot.status === 'booked' || slot.status === 'held') return;

    if (slot.status === 'held_by_me') {
      // Release this one slot
      try {
        await fetch(`${API_BASE}/slots/release`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slotDate: selectedDate, slotTime: slot.time, userId: user.id })
        });
        fetchSlots(true);
      } catch (err) { console.error(err); }
      return;
    }

    // Hold this slot (multiple allowed)
    try {
      const res = await fetch(`${API_BASE}/slots/hold`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotDate: selectedDate, slotTime: slot.time, userId: user.id })
      });
      const data = await res.json();
      if (!data.success) alert(data.message || 'Could not hold slot. Please try again.');
      fetchSlots(true);
    } catch (err) { console.error(err); }
  };

  const releaseOneSlot = async (slot) => {
    try {
      await fetch(`${API_BASE}/slots/release`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotDate: selectedDate, slotTime: slot.time, userId: user.id })
      });
      fetchSlots(true);
    } catch (err) { console.error(err); }
  };

  // ─────────────────────────────────────────────────────────────
  // PAYMENT — single request for all held slots
  // ─────────────────────────────────────────────────────────────
  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    setPaymentError('');
    if (heldSlots.length === 0) { setPaymentError('No slots selected. Go back and select slots.'); return; }
    if (!paymentForm.agreedToTerms) { setPaymentError('Please agree to the cancellation policy.'); return; }
    if (!paymentForm.utrNumber && !paymentForm.screenshot) {
      setPaymentError('Please enter a UTR number or upload a payment screenshot.');
      return;
    }

    setUploadingPayment(true);
    const slotTimesCsv = heldSlots.map(s => s.time).join(', ');
    const fd = new FormData();
    fd.append('userId', user.id);
    fd.append('slotDate', selectedDate);
    fd.append('slotTime', slotTimesCsv);
    fd.append('amount', totalAmount);
    fd.append('utrNumber', paymentForm.utrNumber || '');
    if (paymentForm.screenshot) fd.append('screenshot', paymentForm.screenshot);

    try {
      const res = await fetch(`${API_BASE}/bookings`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        setLastBooking(data.booking);
        setPaymentForm({ utrNumber: '', screenshot: null, agreedToTerms: false });
        setCurrentView('confirmed');
        fetchSlots(true);
      } else {
        setPaymentError(data.message || 'Booking failed. Please try again.');
      }
    } catch {
      setPaymentError('Connection error. Please try again.');
    } finally {
      setUploadingPayment(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // MY BOOKINGS
  // ─────────────────────────────────────────────────────────────
  const fetchMyBookings = async () => {
    if (!user) return;
    setLoadingBookings(true);
    try {
      const res = await fetch(`${API_BASE}/my-bookings?userId=${user.id}`);
      const data = await res.json();
      if (data.success) setMyBookings(data.bookings);
    } catch (err) { console.error(err); }
    finally { setLoadingBookings(false); }
  };

  useEffect(() => { if (currentView === 'bookings') fetchMyBookings(); }, [currentView, user]);

  const handleCancelBooking = async (bookingId) => {
    if (!window.confirm('Cancel this booking? A 50% refund applies if cancelled 3+ hours before the slot.')) return;
    try {
      const res = await fetch(`${API_BASE}/bookings/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, userId: user.id })
      });
      const data = await res.json();
      alert(data.message);
      fetchMyBookings();
      fetchSlots(true);
    } catch (err) { console.error(err); }
  };

  const isCancellationEligible = (slotDate, slotTime) => {
    const [start] = slotTime.split(' - ');
    const [h, m] = start.split(':').map(Number);
    const dt = new Date(slotDate); dt.setHours(h, m, 0, 0);
    return (dt.getTime() - Date.now()) >= 3 * 60 * 60 * 1000;
  };

  // ─────────────────────────────────────────────────────────────
  // ADMIN
  // ─────────────────────────────────────────────────────────────
  const handleAdminLogin = async (e) => {
    e.preventDefault(); setAdminError('');
    try {
      const res = await fetch(`${API_BASE}/auth/admin-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adminCreds)
      });
      const data = await res.json();
      if (data.success) {
        setAdminToken('admin-secret-token');
        localStorage.setItem('admin_token', 'admin-secret-token');
        setShowAdminModal(false);
        setCurrentView('admin');
      } else { setAdminError(data.message); }
    } catch { setAdminError('Connection error.'); }
  };

  const fetchAdminDashboard = async () => {
    if (!adminToken) return;
    try {
      const res = await fetch(`${API_BASE}/admin/bookings?secret=${adminToken}`);
      const data = await res.json();
      if (data.success) {
        setAdminBookings(data.bookings);
        setAdminNotifications(data.notifications);
        setAdminStats({
          totalBookings: data.bookings.filter(b => b.status === 'confirmed').length,
          pendingBookings: data.bookings.filter(b => b.status === 'pending_payment').length,
          totalRevenue: data.bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + b.amount, 0)
        });
      }
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (adminToken && currentView === 'admin') {
      fetchAdminDashboard();
      const i = setInterval(fetchAdminDashboard, 5000);
      return () => clearInterval(i);
    }
  }, [adminToken, currentView]);

  const handleAdminAction = async (bookingId, action) => {
    try {
      const res = await fetch(`${API_BASE}/admin/bookings/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: adminToken, bookingId, action })
      });
      const data = await res.json();
      if (data.success) { fetchAdminDashboard(); fetchSlots(true); }
      else alert(data.message);
    } catch (err) { console.error(err); }
  };

  const formatTime = (secs) =>
    `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  const minExpiry = heldSlots.length > 0
    ? Math.min(...heldSlots.map(s => s.expiresIn || 600)) : 0;

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── ADMIN LOGIN MODAL ─────────────────────────────── */}
      {showAdminModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowAdminModal(false)}>
          <div className="card" style={{ width: 380, padding: '2rem' }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <ShieldAlert size={40} color="var(--primary)" style={{ margin: '0 auto 0.5rem' }} />
              <h2 style={{ margin: 0 }}>Owner Login</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.3rem' }}>Admin access only</p>
            </div>
            {adminError && (
              <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--accent-red)', borderRadius: 8, color: 'var(--accent-red)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <AlertTriangle size={15} /> {adminError}
              </div>
            )}
            <form onSubmit={handleAdminLogin}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input type="text" className="form-input" value={adminCreds.username}
                  onChange={e => setAdminCreds({ ...adminCreds, username: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input type="password" className="form-input" value={adminCreds.password}
                  onChange={e => setAdminCreds({ ...adminCreds, password: e.target.value })} required />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdminModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2 }}>Login as Owner</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="header">
        <div className="header-content">
          <a href="#" className="logo" onClick={() => user && setCurrentView('slots')}>
            <Sparkles size={22} /> SANTHOSH <span>TURF</span>
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {user ? (
              <>
                <button className={`btn btn-secondary ${currentView === 'slots' ? 'active' : ''}`}
                  style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
                  onClick={() => setCurrentView('slots')}>
                  Book Slots
                </button>
                <button className={`btn btn-secondary ${currentView === 'bookings' ? 'active' : ''}`}
                  style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
                  onClick={() => { setCurrentView('bookings'); }}>
                  My Bookings
                </button>
                {heldSlots.length > 0 && (
                  <button className="btn btn-primary"
                    style={{ padding: '0.45rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    onClick={() => setCurrentView('payment')}>
                    <ShoppingCart size={15} />
                    Pay ({heldSlots.length}) · ₹{totalAmount}
                  </button>
                )}
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <User size={14} /> {user.name || user.mobile}
                </div>
                <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={handleLogout} title="Log Out">
                  <LogOut size={15} />
                </button>
              </>
            ) : (
              <button className="btn btn-secondary" style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
                onClick={() => setCurrentView('login')}>
                Login
              </button>
            )}
            {/* Owner button — always visible */}
            <button className="btn btn-secondary"
              style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem', borderColor: 'rgba(139,92,246,0.5)', color: 'rgba(167,139,250,1)' }}
              onClick={() => { if (adminToken) { setCurrentView('admin'); } else { setShowAdminModal(true); } }}>
              <ShieldAlert size={14} style={{ verticalAlign: 'middle', marginRight: 3 }} /> Owner
            </button>
          </div>
        </div>
      </header>

      <main className="app-container">

        {/* ════════ LOGIN PAGE (Default first screen) ════════ */}
        {currentView === 'login' && (
          <div className="animate-slide-up" style={{ maxWidth: 440, margin: '2.5rem auto' }}>
            <div className="card">
              <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <Sparkles size={46} color="var(--primary)" style={{ margin: '0 auto 0.6rem' }} />
                <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Santhosh Turf</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  {authStep === 'email'
                    ? 'Enter your email address to receive OTP'
                    : `OTP sent to ${email}`}
                </p>
              </div>

              {/* Error */}
              {authError && (
                <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--accent-red)', borderRadius: 8, color: 'var(--accent-red)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={15} /> {authError}
                </div>
              )}

              {/* ── STEP 1: Enter email address ── */}
              {authStep === 'email' && (
                <form onSubmit={handleSendOtp}>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      className="form-input"
                      placeholder="Enter your email address"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      autoFocus
                      required
                      style={{ fontSize: '1rem' }}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary"
                    style={{ width: '100%', marginTop: '0.75rem', fontSize: '1rem', padding: '0.85rem' }}
                    disabled={authLoading}>
                    {authLoading
                      ? 'Sending OTP…'
                      : <><Phone size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Send OTP to My Email</>}
                  </button>
                  <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    A 6-digit OTP will be sent to your email address
                  </p>
                </form>
              )}

              {/* ── STEP 2: Enter OTP received in email ── */}
              {authStep === 'otp' && (
                <form onSubmit={handleVerifyOtp}>
                  <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    <div style={{ fontSize: '2.5rem' }}>📧</div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '0.5rem' }}>
                      Check your inbox — OTP sent to<br />
                      <strong style={{ color: 'white', fontSize: '1rem' }}>{email}</strong>
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.3rem' }}>
                      (Also check your Spam / Junk folder)
                    </p>
                  </div>

                  {/* Sandbox warning — only shown when EMAIL_FROM is NOT set in .env */}
                  {sandboxOtp && (
                    <div style={{ padding: '0.9rem', background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 10, marginBottom: '1.25rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', color: 'var(--accent-amber)', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        <Key size={13} /> Sandbox Mode — Email not configured in .env
                      </div>
                      <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '0.4em', color: 'white', fontFamily: 'monospace' }}>
                        {sandboxOtp}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                        Fill in EMAIL_FROM and EMAIL_APP_PASSWORD in .env to remove this
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label" style={{ textAlign: 'center', display: 'block', marginBottom: '0.75rem' }}>
                      Enter the 6-digit OTP
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="form-input"
                      placeholder="- - - - - -"
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength={6}
                      style={{ letterSpacing: '0.6em', textAlign: 'center', fontSize: '1.8rem', fontWeight: 900, padding: '1rem' }}
                      autoFocus
                      required
                    />
                  </div>

                  <button type="submit" className="btn btn-primary"
                    style={{ width: '100%', padding: '0.85rem', fontSize: '1rem' }}
                    disabled={authLoading}>
                    {authLoading ? 'Verifying…' : <><CheckCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Verify & Enter Website</>}
                  </button>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                    <button type="button" className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                      onClick={() => { setAuthStep('email'); setOtpCode(''); setAuthError(''); setSandboxOtp(''); }}>
                      ← Change Email

                    </button>
                    <button type="button" className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                      disabled={otpCountdown > 0}
                      onClick={handleSendOtp}>
                      {otpCountdown > 0 ? `Resend in ${otpCountdown}s` : 'Resend OTP'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* ════════ CHANGE 3: SLOTS (Multiple selection) ════════ */}
        {currentView === 'slots' && user && (
          <div className="animate-slide-up">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <h1 className="text-gradient" style={{ fontSize: '2.3rem', marginBottom: '0.3rem' }}>Book Your Game</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Tap any slot to select · Select multiple slots · Pay all together
                </p>
              </div>
              <div className="card" style={{ padding: '0.9rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Calendar size={18} color="var(--primary)" />
                <input type="date" value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  style={{ background: 'transparent', border: 'none', color: 'white', fontFamily: 'var(--font-sporty)', fontSize: '1.05rem', fontWeight: 600, outline: 'none', cursor: 'pointer' }} />
              </div>
            </div>

            {/* ── Multi-Slot Cart ── */}
            {heldSlots.length > 0 && (
              <div className="card animate-fade-in"
                style={{ marginBottom: '1.5rem', padding: '1.25rem', background: 'rgba(26,217,83,0.06)', border: '1px solid var(--primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', fontWeight: 700, marginBottom: '0.75rem' }}>
                      <ShoppingCart size={16} />
                      {heldSlots.length} Slot{heldSlots.length > 1 ? 's' : ''} Selected
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.8rem' }}>
                        · Hold expires in {formatTime(minExpiry)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {heldSlots.map(slot => (
                        <div key={slot.time}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(26,217,83,0.1)', border: '1px solid var(--primary)', borderRadius: 6, padding: '0.3rem 0.6rem', fontSize: '0.82rem' }}>
                          <span style={{ fontWeight: 600 }}>{slot.time}</span>
                          <span style={{ color: 'var(--primary)', fontWeight: 700 }}>₹{slot.price}</span>
                          <button onClick={() => releaseOneSlot(slot)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0, display: 'flex', alignItems: 'center' }}
                            title="Remove slot">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Amount</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'var(--font-sporty)', color: 'var(--primary)' }}>
                        ₹{totalAmount}
                      </div>
                    </div>
                    <button className="btn btn-primary"
                      style={{ padding: '0.75rem 1.5rem', fontSize: '0.95rem' }}
                      onClick={() => setCurrentView('payment')}>
                      Proceed to Pay →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Slot Grid */}
            {loadingSlots ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <RefreshCw size={28} style={{ margin: '0 auto 0.75rem' }} />
                <p>Loading real-time availability…</p>
              </div>
            ) : slotsError ? (
              <div className="card" style={{ textAlign: 'center', padding: '2.5rem', border: '1px solid var(--accent-red)' }}>
                <AlertTriangle size={32} color="var(--accent-red)" style={{ margin: '0 auto 0.75rem' }} />
                <p>{slotsError}</p>
                <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => fetchSlots()}>Try Again</button>
              </div>
            ) : (
              <div className="slots-grid">
                {slots.map(slot => (
                  <div key={slot.time}
                    className={`slot-card ${slot.status}`}
                    onClick={() => handleSlotClick(slot)}>
                    <div>
                      <div className="time-range">{slot.time}</div>
                      <div className="status-label">{slot.status.replace(/_/g, ' ')}</div>
                      {slot.status === 'held_by_me' && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--accent-amber)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <Clock size={11} /> {formatTime(slot.expiresIn || 0)} · Tap to remove
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.5rem' }}>
                      <div className="price">₹{slot.price}</div>
                      {slot.status === 'available' && (
                        <div style={{ background: 'rgba(26,217,83,0.15)', borderRadius: 4, padding: '0.2rem 0.5rem', color: 'var(--primary)', fontSize: '0.72rem', fontWeight: 700 }}>
                          <Plus size={10} style={{ verticalAlign: 'middle' }} /> Select
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pricing guide */}
            <div className="card" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.015)', marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.6rem' }}>Pricing Guide</h3>
              <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.83rem', lineHeight: 1.8 }}>
                <li>Day slots (6:00 AM – 6:00 PM): <strong>₹900 / hour</strong></li>
                <li>Evening slots (6:00 PM onwards): <strong>₹1300 / hour</strong></li>
                <li>Each slot is 1 hour · 15-minute gap between slots</li>
                <li>Cancellation ≥ 3 hours before slot → <strong>50% refund</strong></li>
              </ul>
            </div>
          </div>
        )}

        {/* ════════ PAYMENT ════════ */}
        {currentView === 'payment' && user && heldSlots.length > 0 && (
          <div className="animate-slide-up" style={{ maxWidth: 620, margin: '0 auto' }}>
            <h1 className="text-gradient" style={{ fontSize: '2rem', textAlign: 'center', marginBottom: '1.5rem' }}>Complete Payment</h1>
            <div className="card">
              {paymentError && (
                <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--accent-red)', borderRadius: 8, color: 'var(--accent-red)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={15} /> {paymentError}
                </div>
              )}

              {/* Slot summary */}
              <div style={{ marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Selected Slots — {selectedDate}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {heldSlots.map(slot => (
                    <div key={slot.time} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.15)', borderRadius: 6, fontSize: '0.9rem' }}>
                      <span style={{ fontWeight: 600 }}>{slot.time}</span>
                      <span style={{ color: 'var(--primary)', fontWeight: 700 }}>₹{slot.price}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0.75rem', fontWeight: 700, borderTop: '1px solid var(--border-color)', marginTop: '0.25rem' }}>
                    <span>Total to Pay</span>
                    <span style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>₹{totalAmount}</span>
                  </div>
                </div>
              </div>

              {/* QR + UPI */}
              <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>Scan with any UPI app to pay</p>
                <div style={{ width: 210, margin: '0 auto 1rem', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', border: '3px solid rgba(255,255,255,0.1)' }}>
                  <img src="/qr-code.jpg" alt="UPI QR Code" style={{ width: '100%', display: 'block' }} />
                </div>
                <div style={{ fontWeight: 700, color: 'white', fontSize: '1rem', marginBottom: '0.4rem' }}>SANTHOSH PRABHU S</div>
                <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.6rem 1rem', borderRadius: 8, border: '1px dashed var(--primary)', display: 'inline-block' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>UPI ID: </span>
                  <strong style={{ fontSize: '0.95rem', color: 'var(--primary)' }}>9843256346@superyes</strong>
                </div>
                <p style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Pay exactly <strong style={{ color: 'white' }}>₹{totalAmount}</strong>
                </p>
              </div>

              <form onSubmit={handlePaymentSubmit}>
                <div className="form-group">
                  <label className="form-label">Transaction UTR / Reference Number</label>
                  <input type="text" className="form-input" placeholder="12-digit UTR number"
                    value={paymentForm.utrNumber}
                    onChange={e => setPaymentForm({ ...paymentForm, utrNumber: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Or Upload Payment Screenshot</label>
                  <div style={{ border: '2px dashed var(--border-color)', borderRadius: 8, padding: '1.25rem', textAlign: 'center', cursor: 'pointer', background: 'rgba(0,0,0,0.1)', position: 'relative' }}>
                    <input type="file" accept="image/*"
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                      onChange={e => setPaymentForm({ ...paymentForm, screenshot: e.target.files[0] })} />
                    <Upload size={22} color="var(--text-muted)" style={{ margin: '0 auto 0.5rem' }} />
                    <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
                      {paymentForm.screenshot ? paymentForm.screenshot.name : 'Click to upload screenshot'}
                    </p>
                  </div>
                </div>
                <div style={{ background: 'rgba(239,68,68,0.05)', padding: '1rem', borderRadius: 8, border: '1px solid rgba(239,68,68,0.15)', margin: '1.25rem 0' }}>
                  <label style={{ display: 'flex', gap: '0.75rem', cursor: 'pointer', alignItems: 'flex-start' }}>
                    <input type="checkbox" style={{ marginTop: '0.15rem', transform: 'scale(1.15)', cursor: 'pointer' }}
                      checked={paymentForm.agreedToTerms}
                      onChange={e => setPaymentForm({ ...paymentForm, agreedToTerms: e.target.checked })} />
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      I agree: <strong>50% refund only if cancelled 3+ hours before the slot.</strong>
                    </span>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setCurrentView('slots')}>← Back</button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={uploadingPayment}>
                    {uploadingPayment ? 'Submitting…' : `Confirm ${heldSlots.length} Slot Booking${heldSlots.length > 1 ? 's' : ''}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ════════ CONFIRMED ════════ */}
        {currentView === 'confirmed' && lastBooking && (
          <div className="animate-slide-up" style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
            <div className="card">
              <CheckCircle size={64} color="var(--primary)" style={{ margin: '0 auto 1.25rem' }} />
              <h1 className="text-gradient" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Booking Submitted!</h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                Your payment is under review. The owner will confirm shortly.
              </p>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setCurrentView('slots')}>Book More</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setCurrentView('bookings')}>My Bookings</button>
              </div>
            </div>
          </div>
        )}

        {/* ════════ MY BOOKINGS ════════ */}
        {currentView === 'bookings' && user && (
          <div className="animate-slide-up">
            <h1 className="text-gradient" style={{ fontSize: '2.2rem', marginBottom: '1.5rem' }}>My Bookings</h1>
            {loadingBookings ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <RefreshCw size={28} style={{ margin: '0 auto 0.75rem' }} /> Loading…
              </div>
            ) : myBookings.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '3.5rem' }}>
                <List size={44} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
                <h3 style={{ marginBottom: '0.5rem' }}>No Bookings Yet</h3>
                <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setCurrentView('slots')}>Book a Slot</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {myBookings.map(b => {
                  const eligible = isCancellationEligible(b.slotDate, b.slotTime.split(', ')[0]) && b.status !== 'cancelled';
                  return (
                    <div key={b.id} className="card"
                      style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Slot(s)</div>
                          <div style={{ fontWeight: 700, fontFamily: 'var(--font-sporty)', fontSize: '0.9rem' }}>{b.slotTime}</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{b.slotDate}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Amount</div>
                          <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '1.1rem' }}>₹{b.amount}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Status</div>
                          <span className={`badge badge-${b.status}`}>{b.status.replace(/_/g, ' ')}</span>
                        </div>
                      </div>
                      {b.status !== 'cancelled' && (
                        <div style={{ textAlign: 'right' }}>
                          <button className="btn btn-secondary"
                            style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', borderColor: eligible ? 'var(--accent-red)' : undefined, color: eligible ? 'var(--accent-red)' : undefined }}
                            onClick={() => handleCancelBooking(b.id)}>
                            Cancel
                          </button>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                            {eligible ? '50% refund eligible' : 'No refund (<3 hrs)'}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════════ ADMIN DASHBOARD ════════ */}
        {currentView === 'admin' && adminToken && (
          <div className="animate-slide-up">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h1 style={{ fontSize: '2.2rem' }}>Owner Dashboard</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Manage bookings and payment approvals</p>
              </div>
              <button className="btn btn-secondary"
                onClick={() => { setAdminToken(''); localStorage.removeItem('admin_token'); setCurrentView('login'); }}>
                Exit Dashboard
              </button>
            </div>

            <div className="admin-grid">
              <div className="admin-stat-card">
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Confirmed</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800 }}>{adminStats.totalBookings}</div>
                </div>
                <CheckCircle size={32} color="var(--primary)" />
              </div>
              <div className="admin-stat-card">
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Pending</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800 }}>{adminStats.pendingBookings}</div>
                </div>
                <Clock size={32} color="var(--accent-amber)" />
              </div>
              <div className="admin-stat-card">
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Revenue</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary)' }}>₹{adminStats.totalRevenue}</div>
                </div>
                <DollarSign size={32} color="var(--primary)" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem', alignItems: 'start' }}>
              <div className="card" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                  <h3>Bookings</h3>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {['all', 'pending_payment', 'confirmed', 'cancelled'].map(f => (
                      <button key={f} className={`btn ${adminFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.3rem 0.7rem', fontSize: '0.72rem' }}
                        onClick={() => setAdminFilter(f)}>
                        {f.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead>
                      <tr><th>Customer</th><th>Slot</th><th>Amount</th><th>Payment</th><th>Status</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                      {adminBookings
                        .filter(b => adminFilter === 'all' || b.status === adminFilter)
                        .map(b => (
                          <tr key={b.id}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{b.userName}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{b.userMobile}</div>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{b.slotTime}</div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{b.slotDate}</div>
                            </td>
                            <td><strong>₹{b.amount}</strong></td>
                            <td>
                              {b.screenshotUrl
                                ? <a href={b.screenshotUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', fontSize: '0.8rem' }}>Screenshot</a>
                                : <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>UTR: {b.utrNumber || 'N/A'}</span>}
                            </td>
                            <td><span className={`badge badge-${b.status}`}>{b.status.replace(/_/g, ' ')}</span></td>
                            <td>
                              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                {b.status === 'pending_payment' && (
                                  <>
                                    <button className="btn btn-primary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem' }} onClick={() => handleAdminAction(b.id, 'approve')}>Approve</button>
                                    <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }} onClick={() => handleAdminAction(b.id, 'reject')}>Reject</button>
                                  </>
                                )}
                                {b.status === 'cancelled' && b.refundEligibility === '50_percent' && !b.refundProcessed && (
                                  <button className="btn btn-primary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', background: 'var(--accent-amber)', color: 'black' }} onClick={() => handleAdminAction(b.id, 'refund')}>Process Refund</button>
                                )}
                                {b.status === 'confirmed' && (
                                  <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }} onClick={() => handleAdminAction(b.id, 'cancel')}>Cancel</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      {adminBookings.length === 0 && (
                        <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No bookings yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card" style={{ padding: '1.25rem', maxHeight: 500, overflowY: 'auto' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Notifications</h3>
                {adminNotifications.map(n => (
                  <div key={n.id} style={{ padding: '0.65rem', background: n.status === 'unread' ? 'rgba(26,217,83,0.06)' : 'rgba(255,255,255,0.02)', borderRadius: 7, borderLeft: `3px solid ${n.status === 'unread' ? 'var(--primary)' : 'var(--text-muted)'}`, marginBottom: '0.5rem', fontSize: '0.78rem' }}>
                    <div style={{ fontWeight: 600 }}>{n.title}</div>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '0.2rem', lineHeight: 1.3 }}>{n.message}</p>
                  </div>
                ))}
                {adminNotifications.length === 0 && (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem' }}>No notifications yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer style={{ marginTop: '4rem', padding: '1.5rem', borderTop: '1px solid var(--border-color)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
        © 2026 Santhosh Turf · All rights reserved
      </footer>
    </div>
  );
}
