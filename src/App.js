/* ==========================================================
   Rojgar AREA — Frontend
   Plain React 18 + Babel-standalone (no build step).
   Backend: Google Apps Script Web App (Code.gs)
   Images:  Cloudinary unsigned upload
   Map:     Leaflet + OpenStreetMap tiles (no API key needed)
   ========================================================== */
   import React, { useState, useEffect, useRef, useContext, createContext, useCallback, useMemo } from 'react';
   import './App.css'; // for the styles
   import L from 'leaflet';
   import 'leaflet/dist/leaflet.css';

   // Leaflet's default marker icon fix
   delete L.Icon.Default.prototype._getIconUrl;
   L.Icon.Default.mergeOptions({
     iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
     iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
     shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
   });

   // ------------------------------------------------------------
   // CONFIG
   // ------------------------------------------------------------
   const CONFIG = {
     APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwHSz0jIvlnM2SJJ_BB6S4GBQ-EQg77CvQR7ULnmKNdVWOYJ2XHu_5NIE6fsDJ-Zbzm/exec',
     CLOUDINARY: {
       cloudName: 'dgrt7q2h3',
       uploadPreset: 'pgrental'
     }
   };

   const WORKER_CATEGORIES = [
     'Skilled Labour', 'Unskilled Labour', 'Driver', 'Electrician', 'Plumber',
     'Mason', 'Welder', 'Machine Operator', 'Helper', 'Security Guard',
     'Tailor / Stitching', 'Packing Staff', 'Delivery Staff', 'Housekeeping',
     'Cook / Kitchen Staff', 'Other'
   ];
   const BUSINESS_TYPES = [
     'Factory', 'Shop / Retail', 'Restaurant / Hotel', 'Construction Site',
     'Warehouse', 'Workshop', 'Office', 'Salon', 'Other'
   ];
   const REPORT_REASONS = [
     'Fake — this business/job does not exist',
     'Salary or terms misrepresented',
     'Position already filled',
     'Scam — asks for money or fees',
     'Discriminatory or inappropriate content',
     'Other'
   ];
   const RADIUS_OPTIONS = [2, 5, 10, 20, 50];
   const HOME_DEFAULT_RADIUS = 10;
   const HOME_MAX_RESULTS = 12;
   const DEFAULT_CENTER = { lat: 30.9010, lng: 75.8573 };

   // ------------------------------------------------------------
   // API
   // ------------------------------------------------------------
   async function apiCall(action, payload = {}) {
     if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.indexOf('PASTE_') === 0) {
       throw new Error('Backend not configured: set CONFIG.APPS_SCRIPT_URL in app.js');
     }
     const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
       method: 'POST',
       headers: { 'Content-Type': 'text/plain;charset=utf-8' },
       body: JSON.stringify({ action, ...payload })
     });
     if (!res.ok) throw new Error('Network error: ' + res.status);
     const data = await res.json();
     if (!data.success) throw new Error(data.message || 'Request failed');
     return data;
   }

   async function uploadToCloudinary(file) {
     const url = `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY.cloudName}/image/upload`;
     const formData = new FormData();
     formData.append('file', file);
     formData.append('upload_preset', CONFIG.CLOUDINARY.uploadPreset);
     const res = await fetch(url, { method: 'POST', body: formData });
     const data = await res.json();
     if (!res.ok) throw new Error((data.error && data.error.message) || 'Image upload failed');
     return data.secure_url;
   }

   // ------------------------------------------------------------
   // UTILITIES
   // ------------------------------------------------------------
   function haversineDistanceKm(lat1, lng1, lat2, lng2) {
     const R = 6371;
     const dLat = (lat2 - lat1) * Math.PI / 180;
     const dLng = (lng2 - lng1) * Math.PI / 180;
     const a = Math.sin(dLat / 2) ** 2 +
       Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
     return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
   }

   function formatDistance(km) {
     if (km == null) return null;
     if (km < 1) return `${Math.round(km * 1000)} m away`;
     return `${km.toFixed(1)} km away`;
   }

   function parseSalaryNumber(s) {
     if (!s) return 0;
     const nums = String(s).match(/\d+/g);
     if (!nums) return 0;
     return Math.max(...nums.map(Number));
   }

   function categoryOf(ad) {
     return (ad.workerCategory === 'Other' && ad.customCategory) ? ad.customCategory : (ad.displayCategory || ad.workerCategory);
   }

   function buildCategoryOptions(ads) {
     const set = new Set(WORKER_CATEGORIES.filter((c) => c !== 'Other'));
     (ads || []).forEach((a) => { if (categoryOf(a)) set.add(categoryOf(a)); });
     return Array.from(set).sort();
   }

   function withDistances(ads, userCoords) {
     return ads.map((a) => {
       let distanceKm = null;
       if (userCoords && a.locationLat != null && a.locationLng != null) {
         distanceKm = haversineDistanceKm(userCoords.lat, userCoords.lng, a.locationLat, a.locationLng);
       }
       return { ...a, distanceKm };
     });
   }

   const EMPTY_FILTERS = {
     search: '', category: '', businessType: '', radius: 'all',
     minSalary: '', experience: '', education: '', skills: '', sortBy: ''
   };

   function filterAndSortAds(ads, filters, userCoords) {
     let list = withDistances(ads, userCoords);

     if (filters.radius && filters.radius !== 'all' && userCoords) {
       list = list.filter((a) => a.distanceKm == null || a.distanceKm <= Number(filters.radius));
     }
     if (filters.search) {
       const q = filters.search.toLowerCase();
       list = list.filter((a) =>
         `${a.jobTitle} ${a.businessName} ${a.description} ${a.skills} ${categoryOf(a)}`.toLowerCase().includes(q));
     }
     if (filters.category) list = list.filter((a) => categoryOf(a) === filters.category);
     if (filters.businessType) list = list.filter((a) => a.businessType === filters.businessType);
     if (filters.minSalary) list = list.filter((a) => parseSalaryNumber(a.salary) >= Number(filters.minSalary));
     if (filters.experience) list = list.filter((a) => (a.experience || '').toLowerCase().includes(filters.experience.toLowerCase()));
     if (filters.education) list = list.filter((a) => (a.education || '').toLowerCase().includes(filters.education.toLowerCase()));
     if (filters.skills) list = list.filter((a) => (a.skills || '').toLowerCase().includes(filters.skills.toLowerCase()));

     const sortBy = filters.sortBy || (userCoords ? 'distance' : 'newest');
     list.sort((a, b) => {
       if (sortBy === 'distance') {
         if (a.distanceKm == null && b.distanceKm == null) return new Date(b.postedAt) - new Date(a.postedAt);
         if (a.distanceKm == null) return 1;
         if (b.distanceKm == null) return -1;
         return a.distanceKm - b.distanceKm;
       }
       if (sortBy === 'salary') return parseSalaryNumber(b.salary) - parseSalaryNumber(a.salary);
       return new Date(b.postedAt) - new Date(a.postedAt);
     });
     return list;
   }

   // ------------------------------------------------------------
   // CONTEXTS
   // ------------------------------------------------------------
   const AuthContext = createContext(null);
   const ToastContext = createContext(null);
   const GeoContext = createContext(null);
   const useAuth = () => useContext(AuthContext);
   const useToast = () => useContext(ToastContext);
   const useGeo = () => useContext(GeoContext);

   function useGeolocation() {
     const [state, setState] = useState({ status: 'idle', coords: null, error: null });
     const request = useCallback(() => {
       if (!navigator.geolocation) { setState({ status: 'unsupported', coords: null, error: null }); return; }
       setState((s) => ({ ...s, status: 'requesting' }));
       navigator.geolocation.getCurrentPosition(
         (pos) => setState({ status: 'granted', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude }, error: null }),
         (err) => setState({ status: 'denied', coords: null, error: err.message }),
         { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
       );
     }, []);
     return { ...state, request };
   }

   // ------------------------------------------------------------
   // SMALL UI PRIMITIVES
   // ------------------------------------------------------------
   function Spinner({ label }) {
     return (
       <div className="state-box">
         <div className="spinner"></div>
         {label && <div>{label}</div>}
       </div>
     );
   }

   function ErrorState({ message, onRetry }) {
     return (
       <div className="state-box">
         <div className="error-box">{message || 'Something went wrong.'}</div>
         {onRetry && <button className="btn btn-outline" style={{ marginTop: 14 }} onClick={onRetry}>Try again</button>}
       </div>
     );
   }

   function EmptyState({ title, message, icon }) {
     return (
       <div className="state-box">
         <div className="empty-illustration">{icon || '📋'}</div>
         <h3>{title}</h3>
         <p>{message}</p>
       </div>
     );
   }

   function StatusBadge({ status }) {
     const labels = {
       active: 'Active', inactive: 'Paused', taken_down: 'Taken Down', pending: 'Pending',
       actioned: 'Actioned', dismissed: 'Dismissed'
     };
     return <span className={`badge badge-${status}`}>{labels[status] || status}</span>;
   }

   function Toast({ toast }) {
     if (!toast) return null;
     return <div className={`toast ${toast.type}`}>{toast.message}</div>;
   }

   function DistanceChip({ km }) {
     const label = formatDistance(km);
     if (!label) return null;
     return <span className="distance-chip">📍 {label}</span>;
   }

   function LocationBanner({ compact }) {
     const geo = useGeo();
     if (geo.status === 'granted') return null;
     return (
       <div className={`location-banner ${compact ? 'compact' : ''}`}>
         <div className="location-banner-text">
           {geo.status === 'requesting' && 'Finding your location…'}
           {geo.status === 'unsupported' && "Your browser doesn't support location — showing all listings instead."}
           {(geo.status === 'idle' || geo.status === 'denied') &&
             'Turn on location to see jobs sorted by distance from you.'}
         </div>
         {(geo.status === 'idle' || geo.status === 'denied') && (
           <button className="btn btn-primary btn-sm" onClick={geo.request}>📍 Use my location</button>
         )}
       </div>
     );
   }

   function RadiusSelect({ value, onChange, disabled }) {
     return (
       <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
         <option value="all">Any distance</option>
         {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>Within {r} km</option>)}
       </select>
     );
   }

   // ------------------------------------------------------------
   // MAP VIEW
   // ------------------------------------------------------------
   function MapView({ lat, lng, interactive = false, markerDraggable = false, onPick, zoom = 13, height }) {
     const containerRef = useRef(null);
     const mapRef = useRef(null);
     const markerRef = useRef(null);
     const onPickRef = useRef(onPick);
     useEffect(() => { onPickRef.current = onPick; }, [onPick]);

     const placeMarker = (map, la, ln) => {
       if (markerRef.current) {
         markerRef.current.setLatLng([la, ln]);
       } else {
         markerRef.current = L.marker([la, ln], { draggable: markerDraggable }).addTo(map);
         if (markerDraggable) {
           markerRef.current.on('dragend', () => {
             const p = markerRef.current.getLatLng();
             onPickRef.current && onPickRef.current(p.lat, p.lng);
           });
         }
       }
     };

     useEffect(() => {
       if (!containerRef.current || mapRef.current) return;
       const startLat = lat != null ? lat : DEFAULT_CENTER.lat;
       const startLng = lng != null ? lng : DEFAULT_CENTER.lng;

       const map = L.map(containerRef.current, {
         zoomControl: interactive,
         dragging: interactive,
         scrollWheelZoom: interactive,
         doubleClickZoom: interactive,
         touchZoom: interactive,
         tap: interactive,
       }).setView([startLat, startLng], zoom);

       L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
         attribution: '&copy; OpenStreetMap contributors',
         maxZoom: 19,
       }).addTo(map);

       if (lat != null && lng != null) placeMarker(map, lat, lng);

       if (interactive) {
         map.on('click', (e) => {
           placeMarker(map, e.latlng.lat, e.latlng.lng);
           onPickRef.current && onPickRef.current(e.latlng.lat, e.latlng.lng);
         });
       }

       mapRef.current = map;

       const invalidate = () => { if (mapRef.current) mapRef.current.invalidateSize(); };
       const timers = [80, 250, 600].map((ms) => setTimeout(invalidate, ms));
       let resizeObserver;
       if (window.ResizeObserver) {
         resizeObserver = new ResizeObserver(invalidate);
         resizeObserver.observe(containerRef.current);
       }
       window.addEventListener('resize', invalidate);

       return () => {
         timers.forEach(clearTimeout);
         window.removeEventListener('resize', invalidate);
         if (resizeObserver) resizeObserver.disconnect();
         if (mapRef.current) {
           mapRef.current.off();
           mapRef.current.remove();
           mapRef.current = null;
         }
         markerRef.current = null;
       };
       // eslint-disable-next-line react-hooks/exhaustive-deps
     }, []);

     useEffect(() => {
       if (!mapRef.current || lat == null || lng == null) return;
       mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), zoom));
       placeMarker(mapRef.current, lat, lng);
       setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
       // eslint-disable-next-line react-hooks/exhaustive-deps
     }, [lat, lng]);

     return <div ref={containerRef} className="leaflet-map" style={height ? { height } : undefined}></div>;
   }

   // ------------------------------------------------------------
   // LIGHTBOX
   // ------------------------------------------------------------
   function Lightbox({ images, index, onClose, onNav }) {
     useEffect(() => {
       const onKey = (e) => {
         if (e.key === 'Escape') onClose();
         if (e.key === 'ArrowRight') onNav(1);
         if (e.key === 'ArrowLeft') onNav(-1);
       };
       window.addEventListener('keydown', onKey);
       return () => window.removeEventListener('keydown', onKey);
     }, [onClose, onNav]);

     if (index == null) return null;
     return (
       <div className="lightbox-overlay" onClick={onClose}>
         <button className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>
         {images.length > 1 && (
           <button className="lightbox-nav prev" onClick={(e) => { e.stopPropagation(); onNav(-1); }} aria-label="Previous">‹</button>
         )}
         <img src={images[index]} className="lightbox-img" alt="" onClick={(e) => e.stopPropagation()} />
         {images.length > 1 && (
           <button className="lightbox-nav next" onClick={(e) => { e.stopPropagation(); onNav(1); }} aria-label="Next">›</button>
         )}
         {images.length > 1 && <div className="lightbox-count">{index + 1} / {images.length}</div>}
       </div>
     );
   }

   // ==============================================================
   // APP ROOT
   // ==============================================================
   function App() {
     const [user, setUser] = useState(() => {
       try { return JSON.parse(localStorage.getItem('kb_user')) || null; } catch (e) { return null; }
     });
     const [route, setRoute] = useState({ page: 'home', params: {} });
     const [toast, setToast] = useState(null);
     const geo = useGeolocation();

     useEffect(() => { geo.request(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

     const navigate = (page, params = {}) => {
       setRoute({ page, params });
       window.scrollTo(0, 0);
     };

     const showToast = useCallback((message, type = 'success') => {
       setToast({ message, type });
       setTimeout(() => setToast(null), 3200);
     }, []);

     const login = (u) => {
       setUser(u);
       localStorage.setItem('kb_user', JSON.stringify(u));
     };
     const logout = () => {
       setUser(null);
       localStorage.removeItem('kb_user');
       navigate('home');
     };

     const authValue = { user, login, logout };

     return (
       <AuthContext.Provider value={authValue}>
         <GeoContext.Provider value={geo}>
           <ToastContext.Provider value={showToast}>
             <div className="app-shell">
               <Navbar route={route} navigate={navigate} />
               <MainRouter route={route} navigate={navigate} />
               <Footer navigate={navigate} />
               <Toast toast={toast} />
             </div>
           </ToastContext.Provider>
         </GeoContext.Provider>
       </AuthContext.Provider>
     );
   }

   function MainRouter({ route, navigate }) {
     const { user } = useAuth();
     switch (route.page) {
       case 'home': return <HomePage navigate={navigate} />;
       case 'browse': return <AdvertisementsPage navigate={navigate} initialFilters={route.params.filters} />;
       case 'details': return <AdDetailsPage adId={route.params.adId} navigate={navigate} />;
       case 'post': return user ? <AdFormPage navigate={navigate} mode="create" /> : <LoginPage navigate={navigate} initialMode="login" redirectTo="post" />;
       case 'edit': return user ? <AdFormPage navigate={navigate} mode="edit" adId={route.params.adId} /> : <LoginPage navigate={navigate} initialMode="login" redirectTo="dashboard" />;
       case 'dashboard': return user ? <UserDashboardPage navigate={navigate} /> : <LoginPage navigate={navigate} initialMode="login" redirectTo="dashboard" />;
       case 'admin': return (user && user.role === 'admin') ? <AdminDashboardPage navigate={navigate} /> : <LoginPage navigate={navigate} initialMode="login" redirectTo="admin" />;
       case 'login': return <LoginPage navigate={navigate} initialMode="login" redirectTo={route.params.redirectTo} />;
       case 'register': return <LoginPage navigate={navigate} initialMode="register" redirectTo={route.params.redirectTo} />;
       default: return <HomePage navigate={navigate} />;
     }
   }

   function Footer({ navigate }) {
     const handleNav = (path, params) => (e) => {
       e.preventDefault();
       navigate(path, params || {});
     };

     return (
       <div className="footer">
         <div className="container">
           <div className="footer-grid">
             <div className="footer-col">
               <h4>Rojgar AREA
               </h4>
               <p>Connecting local businesses with workers across India. Find jobs near you or post requirements instantly.</p>
             </div>
             <div className="footer-col">
               <h4>Quick Links</h4>
               <button className="footer-link" onClick={handleNav('browse')}>Browse Jobs</button>
               <button className="footer-link" onClick={handleNav('post')}>Post a Job</button>
               <button className="footer-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>About Us</button>
               <button className="footer-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Contact</button>
             </div>
             <div className="footer-col">
               <h4>Popular Searches</h4>
               <button className="footer-link" onClick={handleNav('browse', { filters: { ...EMPTY_FILTERS, radius: HOME_DEFAULT_RADIUS } })}>Jobs Near Me</button>
               <button className="footer-link" onClick={handleNav('browse', { filters: { ...EMPTY_FILTERS, search: 'part time' } })}>Part Time Jobs</button>
               <button className="footer-link" onClick={handleNav('browse', { filters: { ...EMPTY_FILTERS, search: 'work from home' } })}>Work From Home</button>
               <button className="footer-link" onClick={handleNav('browse', { filters: { ...EMPTY_FILTERS, search: 'fresher' } })}>Fresher Jobs</button>
             </div>
             <div className="footer-col">
               <h4>Legal</h4>
               <button className="footer-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Privacy Policy</button>
               <button className="footer-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Terms of Service</button>
               <button className="footer-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Cookie Policy</button>
             </div>
           </div>
           <div className="footer-bottom">
             <span>© 2026 Rojgar AREA — Made in India 🇮🇳</span>
           </div>
         </div>
       </div>
     );
   }

   // ==============================================================
   // NAVBAR
   // ==============================================================
   function Navbar({ route, navigate }) {
     const { user, logout } = useAuth();
     const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

     // NEW IMAGE URL FOR BRAND MARK
     const brandImageUrl = 'https://i.postimg.cc/J7SjVdTM/8798a3b8-de7e-4822-a59f-fbb77cabfb7c.png';

     return (
       <div className="navbar">
         <div className="container navbar-inner">
           <div className="brand" onClick={() => { navigate('home'); setMobileMenuOpen(false); }}>
             {/* Replaced text 'R_A_' with image */}
             <img src={brandImageUrl} alt="Rojgar AREA logo" className="brand-mark-img" />
             <div className="brand-text">Rojgar<span>AREA</span></div>
           </div>
           <button className="mobile-menu-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle menu">
             {mobileMenuOpen ? '✕' : '☰'}
           </button>
           <div className={`nav-links ${mobileMenuOpen ? 'open' : ''}`}>
             <button className={`nav-link ${route.page === 'home' ? 'active' : ''}`} onClick={() => { navigate('home'); setMobileMenuOpen(false); }}>Home</button>
             <button className={`nav-link ${route.page === 'browse' ? 'active' : ''}`} onClick={() => { navigate('browse'); setMobileMenuOpen(false); }}>Browse Jobs</button>
             <button className={`nav-link ${route.page === 'post' ? 'active' : ''}`} onClick={() => { navigate('post'); setMobileMenuOpen(false); }}>Post a Requirement</button>
             {user && <button className={`nav-link ${route.page === 'dashboard' ? 'active' : ''}`} onClick={() => { navigate('dashboard'); setMobileMenuOpen(false); }}>My Dashboard</button>}
             {user && user.role === 'admin' && <button className={`nav-link ${route.page === 'admin' ? 'active' : ''}`} onClick={() => { navigate('admin'); setMobileMenuOpen(false); }}>Admin</button>}
           </div>
           <div className={`nav-user ${mobileMenuOpen ? 'open' : ''}`}>
             {user ? (
               <>
                 <div className="nav-avatar" title={user.name}>{user.name.charAt(0).toUpperCase()}</div>
                 <button className="btn-ghost-light" onClick={logout}>Log out</button>
               </>
             ) : (
               <>
                 <button className="btn-ghost-light" onClick={() => { navigate('login'); setMobileMenuOpen(false); }}>Log in</button>
                 <button className="btn btn-primary btn-sm" onClick={() => { navigate('register'); setMobileMenuOpen(false); }}>Sign up</button>
               </>
             )}
           </div>
         </div>
       </div>
     );
   }

   // ==============================================================
   // HOME PAGE
   // ==============================================================
   function HomePage({ navigate }) {
     const geo = useGeo();
     const [allAds, setAllAds] = useState(null);
     const [error, setError] = useState(null);
     const [search, setSearch] = useState('');
     const [locationSearch, setLocationSearch] = useState('');

     const load = useCallback(() => {
       setAllAds(null); setError(null);
       apiCall('getAds', {}).then((data) => setAllAds(data.ads)).catch((err) => setError(err.message));
     }, []);
     useEffect(() => { load(); }, [load]);

     const runSearch = (e) => {
       e.preventDefault();
       navigate('browse', { filters: { ...EMPTY_FILTERS, search } });
     };

     const runNearbySearch = () => {
       if (geo.status === 'granted') {
         navigate('browse', { filters: { ...EMPTY_FILTERS, radius: HOME_DEFAULT_RADIUS } });
       } else {
         geo.request();
         navigate('browse', { filters: { ...EMPTY_FILTERS } });
       }
     };

     const nearby = useMemo(() => {
       if (!allAds) return null;
       const filters = geo.status === 'granted'
         ? { ...EMPTY_FILTERS, radius: HOME_DEFAULT_RADIUS }
         : EMPTY_FILTERS;
       return filterAndSortAds(allAds, filters, geo.coords).slice(0, HOME_MAX_RESULTS);
     }, [allAds, geo.status, geo.coords]);

     return (
       <div>
         <div className="hero">
           <div className="container">
             <div className="hero-badge">🇮🇳 India's Local Job Platform</div>
             <h1>Find <em>jobs near you</em> — posted directly by local businesses</h1>
             <p>Discover thousands of worker requirements from factories, shops, restaurants, and workshops in your area. No middlemen, direct connection.</p>
             
             <form className="hero-search" onSubmit={runSearch}>
               <div className="hero-search-group">
                 <div className="hero-search-field">
                   <span className="hero-search-icon">🔍</span>
                   <input
                     type="text"
                     placeholder="Search job title, skill, or business..."
                     value={search}
                     onChange={(e) => setSearch(e.target.value)}
                   />
                 </div>
                 <div className="hero-search-field">
                   <span className="hero-search-icon">📍</span>
                   <input
                     type="text"
                     placeholder="Enter your location"
                     value={locationSearch}
                     onChange={(e) => setLocationSearch(e.target.value)}
                   />
                 </div>
                 <button type="submit" className="btn btn-primary btn-lg">Search Jobs</button>
               </div>
             </form>

             <div className="hero-actions">
               <button className="btn btn-outline-light" onClick={runNearbySearch}>
                 📍 Find Jobs Near Me
               </button>
               <span className="hero-stats">
                 <strong>50+</strong> active requirements · <strong>{allAds?.length || 0}</strong> total listings
               </span>
             </div>

             <div className="hero-trust">
               <span>Trusted by 1000+ businesses across India</span>
             </div>
           </div>
         </div>

         <div className="container">
           <LocationBanner />

           <div className="section-head">
             <h2>
               {geo.status === 'granted' ? `Jobs within ${HOME_DEFAULT_RADIUS} km of you` : 'Recently posted requirements'}
               {nearby && <span className="count-pill">{nearby.length}</span>}
             </h2>
             <button className="btn btn-outline btn-sm" onClick={() => navigate('browse', geo.status === 'granted' ? { filters: { ...EMPTY_FILTERS, radius: HOME_DEFAULT_RADIUS } } : undefined)}>
               View all →
             </button>
           </div>

           {allAds === null && !error && <Spinner label="Loading advertisements..." />}
           {error && <ErrorState message={error} onRetry={load} />}
           {nearby && nearby.length === 0 && (
             <EmptyState icon="🗂️" title="No advertisements found nearby" message="Try widening your search radius from the Browse Jobs page." />
           )}
           {nearby && nearby.length > 0 && (
             <div className="grid">
               {nearby.map((ad) => <AdCard key={ad.adId} ad={ad} onClick={() => navigate('details', { adId: ad.adId })} />)}
             </div>
           )}

           <div className="seo-content">
             <h2>Find Jobs Near You in India</h2>
             <p>
               Rojgar AREA connects job seekers with local employment opportunities across India. 
               Whether you're looking for <strong>jobs near me</strong>, <strong>rojgar near me</strong>, 
               or <strong>Rojgar ki vacancy</strong> in your city, our platform makes it easy to find 
               work opportunities from verified local businesses.
             </p>
             <div className="seo-grid">
               <div className="seo-col">
                 <h3>Popular Job Categories</h3>
                 <ul>
                   <li>Skilled Labour Jobs</li>
                   <li>Driver Jobs Near Me</li>
                   <li>Electrician Jobs</li>
                   <li>Plumber Jobs</li>
                   <li>Machine Operator Jobs</li>
                   <li>Security Guard Jobs</li>
                 </ul>
               </div>
               <div className="seo-col">
                 <h3>Top Cities for Jobs</h3>
                 <ul>
                   <li>Jobs in Ludhiana</li>
                   <li>Jobs in Chandigarh</li>
                   <li>Jobs in Amritsar</li>
                   <li>Jobs in Mohali</li>
                   <li>Jobs in Mansa</li>
                   <li>Jobs in Punjab</li>
                 </ul>
               </div>
               <div className="seo-col">
                 <h3>Employment Types</h3>
                 <ul>
                   <li>Full Time Jobs Near Me</li>
                   <li>Part Time Jobs Near Me</li>
                   <li>Work From Home Jobs</li>
                   <li>Fresher Jobs Near Me</li>
                   <li>Daily Jobs Near Me</li>
                   <li>Contract Jobs</li>
                 </ul>
               </div>
             </div>
           </div>
         </div>
       </div>
     );
   }

   function AdCard({ ad, onClick }) {
     const hasImages = ad.images && ad.images.length > 0;
     const isNew = new Date(ad.postedAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
     return (
       <div className="ad-card" onClick={onClick}>
         <div className="ad-card-img" style={hasImages ? { backgroundImage: `url(${ad.images[0]})` } : {}}>
           {!hasImages && <div className="no-img">No photo</div>}
           {ad.images && ad.images.length > 1 && <div className="ad-card-count">{ad.images.length} photos</div>}
           {ad.status !== 'active' && <div className="ad-card-badge"><StatusBadge status={ad.status} /></div>}
           {isNew && <div className="ad-card-new">New</div>}
         </div>
         <div className="ad-card-body">
           <div className="ad-card-title">{ad.jobTitle}</div>
           <div className="ad-card-biz">{ad.businessName} · {ad.businessType}</div>
           <div className="ad-card-meta">
             <span>📍 {ad.locationAddress || 'Location on request'}</span>
             <span>👷 {ad.numWorkers} needed</span>
           </div>
           {ad.distanceKm != null && <div className="ad-card-distance"><DistanceChip km={ad.distanceKm} /></div>}
           <div className="ad-card-footer">
             <span className="salary-tag">{ad.salary ? `₹ ${ad.salary}` : 'Salary: negotiable'}</span>
             <span className="mono" style={{ fontSize: 12, color: 'var(--text-mute)' }}>{categoryOf(ad)}</span>
           </div>
         </div>
       </div>
     );
   }

   // ==============================================================
   // FILTER PANEL
   // ==============================================================
   function FilterPanel({ filters, setFilters, categoryOptions, geoStatus, onRequestLocation, resultCount }) {
     const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
     const reset = () => setFilters({ ...EMPTY_FILTERS });

     return (
       <div className="filter-sidebar">
         <div className="filter-sidebar-head">
           <h3>Filters</h3>
           <button className="link-btn" onClick={reset}>Reset all</button>
         </div>

         <div className="field">
           <label>Search</label>
           <input value={filters.search} onChange={(e) => set('search', e.target.value)} placeholder="Job title, business, skill..." />
         </div>

         <div className="field">
           <label>Distance</label>
           {geoStatus === 'granted'
             ? <RadiusSelect value={filters.radius} onChange={(v) => set('radius', v)} />
             : (
               <button className="btn btn-outline btn-sm btn-block" onClick={onRequestLocation}>📍 Enable location to filter by distance</button>
             )}
         </div>

         <div className="field">
           <label>Worker category</label>
           <select value={filters.category} onChange={(e) => set('category', e.target.value)}>
             <option value="">All categories</option>
             {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
           </select>
         </div>

         <div className="field">
           <label>Business type</label>
           <select value={filters.businessType} onChange={(e) => set('businessType', e.target.value)}>
             <option value="">All business types</option>
             {BUSINESS_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
           </select>
         </div>

         <div className="field">
           <label>Minimum salary (₹/month)</label>
           <input type="number" min="0" value={filters.minSalary} onChange={(e) => set('minSalary', e.target.value)} placeholder="e.g. 10000" />
         </div>

         <div className="field">
           <label>Experience</label>
           <input value={filters.experience} onChange={(e) => set('experience', e.target.value)} placeholder="e.g. fresher, 2+ years" />
         </div>

         <div className="field">
           <label>Education</label>
           <input value={filters.education} onChange={(e) => set('education', e.target.value)} placeholder="e.g. 10th pass" />
         </div>

         <div className="field">
           <label>Skills</label>
           <input value={filters.skills} onChange={(e) => set('skills', e.target.value)} placeholder="e.g. stitching, driving" />
         </div>

         <div className="field">
           <label>Sort by</label>
           <select value={filters.sortBy} onChange={(e) => set('sortBy', e.target.value)}>
             <option value="">{geoStatus === 'granted' ? 'Nearest first' : 'Newest first'}</option>
             <option value="newest">Newest first</option>
             {geoStatus === 'granted' && <option value="distance">Nearest first</option>}
             <option value="salary">Highest salary first</option>
           </select>
         </div>

         {typeof resultCount === 'number' && <div className="filter-result-count">{resultCount} matching {resultCount === 1 ? 'job' : 'jobs'}</div>}
       </div>
     );
   }

   // ==============================================================
   // ADVERTISEMENTS PAGE
   // ==============================================================
   function AdvertisementsPage({ navigate, initialFilters }) {
     const geo = useGeo();
     const [allAds, setAllAds] = useState(null);
     const [error, setError] = useState(null);
     const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...(initialFilters || {}) });

     const load = useCallback(() => {
       setAllAds(null); setError(null);
       apiCall('getAds', {}).then((data) => setAllAds(data.ads)).catch((err) => setError(err.message));
     }, []);
     useEffect(() => { load(); }, [load]);

     const results = useMemo(() => {
       if (!allAds) return null;
       return filterAndSortAds(allAds, filters, geo.coords);
     }, [allAds, filters, geo.coords]);

     const categoryOptions = useMemo(() => buildCategoryOptions(allAds || []), [allAds]);

     return (
       <div className="container">
         <div className="section-head" style={{ marginTop: 30 }}>
           <h2>All job requirements {results && <span className="count-pill">{results.length}</span>}</h2>
         </div>

         <LocationBanner compact />

         <div className="browse-layout">
           <FilterPanel
             filters={filters} setFilters={setFilters}
             categoryOptions={categoryOptions}
             geoStatus={geo.status} onRequestLocation={geo.request}
             resultCount={results ? results.length : undefined}
           />
           <div className="browse-results">
             {allAds === null && !error && <Spinner label="Loading advertisements..." />}
             {error && <ErrorState message={error} onRetry={load} />}
             {results && results.length === 0 && (
               <EmptyState icon="🗂️" title="No advertisements found" message="Try clearing some filters or widening your search radius." />
             )}
             {results && results.length > 0 && (
               <div className="grid">
                 {results.map((ad) => <AdCard key={ad.adId} ad={ad} onClick={() => navigate('details', { adId: ad.adId })} />)}
               </div>
             )}
           </div>
         </div>
       </div>
     );
   }

   // ==============================================================
   // AD DETAILS PAGE
   // ==============================================================
   function AdDetailsPage({ adId, navigate }) {
     const { user } = useAuth();
     const geo = useGeo();
     const toast = useToast();
     const [ad, setAd] = useState(null);
     const [error, setError] = useState(null);
     const [activeImg, setActiveImg] = useState(0);
     const [lightboxIndex, setLightboxIndex] = useState(null);
     const [saved, setSaved] = useState(false);
     const [reportOpen, setReportOpen] = useState(false);
     const [, setApplied] = useState(false);

     const load = useCallback(() => {
       setAd(null); setError(null);
       apiCall('getAdById', { adId }).then((data) => setAd(data.ad)).catch((err) => setError(err.message));
     }, [adId]);

     useEffect(() => { load(); }, [load]);

     useEffect(() => {
       if (user && ad) {
         apiCall('getSavedAds', { userId: user.userId })
           .then((data) => setSaved(data.ads.some((a) => a.adId === ad.adId)))
           .catch(() => {});
         apiCall('getAppliedAds', { userId: user.userId })
           .then((data) => setApplied(data.ads.some((a) => a.adId === ad.adId)))
           .catch(() => {});
       }
     }, [user, ad]);

     if (error) return <div className="container"><ErrorState message={error} onRetry={load} /></div>;
     if (!ad) return <div className="container"><Spinner label="Loading advertisement..." /></div>;

     const distanceKm = (geo.coords && ad.locationLat != null && ad.locationLng != null)
       ? haversineDistanceKm(geo.coords.lat, geo.coords.lng, ad.locationLat, ad.locationLng)
       : null;

     const toggleSave = async () => {
       if (!user) { navigate('login', { redirectTo: 'home' }); return; }
       try {
         if (saved) { await apiCall('removeSavedAd', { userId: user.userId, adId: ad.adId }); setSaved(false); toast('Removed from saved.', 'success'); }
         else { await apiCall('saveAd', { userId: user.userId, adId: ad.adId }); setSaved(true); toast('Saved to your dashboard.', 'success'); }
       } catch (err) { toast(err.message, 'error'); }
     };


     const isOwner = user && ad.postedBy === user.userId;
     const images = ad.images || [];

     const jobStructuredData = {
       "@context": "https://schema.org",
       "@type": "JobPosting",
       "title": ad.jobTitle,
       "description": ad.description || `Looking for ${ad.jobTitle} in ${ad.locationAddress || 'local area'}`,
       "hiringOrganization": {
         "@type": "Organization",
         "name": ad.businessName
       },
       "jobLocation": {
         "@type": "Place",
         "address": {
           "@type": "PostalAddress",
           "addressLocality": ad.locationAddress || 'Local Area',
           "addressCountry": "IN"
         }
       },
       "employmentType": "FULL_TIME",
       "datePosted": ad.postedAt,
       "validThrough": new Date(new Date(ad.postedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
       "baseSalary": ad.salary ? {
         "@type": "MonetaryAmount",
         "currency": "INR",
         "value": {
           "@type": "QuantitativeValue",
           "value": parseSalaryNumber(ad.salary),
           "unitText": "MONTH"
         }
       } : undefined,
       "applicantLocationRequirements": {
         "@type": "Country",
         "name": "India"
       }
     };

     return (
       <div className="container">
         <script type="application/ld+json">
           {JSON.stringify(jobStructuredData)}
         </script>

         {ad.status === 'taken_down' && (
           <div className="takedown-banner" style={{ marginTop: 24 }}>
             <div>
               <strong>This advertisement was taken down by an admin</strong>
               It was reviewed and removed for misleading content. Reason: {ad.takedownReason || 'Reported as misleading.'}
             </div>
           </div>
         )}
         {ad.status === 'inactive' && (
           <div className="takedown-banner inactive-banner" style={{ marginTop: 24 }}>
             <div>
               <strong>This advertisement is paused</strong>
               {isOwner ? ' Only you can see it — reactivate it from your dashboard when you\'re ready to hire again.' : ' It is not currently accepting applicants.'}
             </div>
           </div>
         )}

         {isOwner && ad.status !== 'taken_down' && (
           <div className="owner-toolbar">
             <span>This is your listing.</span>
             <button className="btn btn-outline btn-sm" onClick={() => navigate('edit', { adId: ad.adId })}>✎ Edit</button>
             <button className="btn btn-outline btn-sm" onClick={() => navigate('dashboard')}>Go to dashboard</button>
           </div>
         )}

         <div className="details-hero">
           <div>
             <div className="gallery-main" onClick={() => images.length && setLightboxIndex(activeImg)}>
               {images.length > 0
                 ? <img src={images[activeImg]} alt={ad.jobTitle} />
                 : <div className="no-img" style={{ height: '100%' }}>No photos provided</div>}
               {images.length > 0 && <div className="gallery-expand-hint">⤢ View full size</div>}
             </div>
             {images.length > 1 && (
               <div className="gallery-thumbs">
                 {images.map((src, i) => (
                   <img key={i} src={src} alt={`Thumbnail ${i + 1}`} className={i === activeImg ? 'active' : ''} onClick={() => setActiveImg(i)} />
                 ))}
               </div>
             )}

             <div className="desc-block">
               <h3>Job Description</h3>
               <p>{ad.description || 'No additional description provided.'}</p>
             </div>
             <div className="desc-block">
               <h3>Required Skills</h3>
               <p>{ad.skills || 'Not specified.'}</p>
             </div>
             {ad.locationLat != null && ad.locationLng != null && (
               <div className="desc-block">
                 <h3>Workplace Location</h3>
                 <p>{ad.locationAddress || 'Pinned on the map below.'}{distanceKm != null && ` · ${formatDistance(distanceKm)}`}</p>
                 <div className="map-wrap">
                   <MapView lat={ad.locationLat} lng={ad.locationLng} height="260px" />
                 </div>
               </div>
             )}
           </div>

           <div className="details-panel">
             <StatusBadge status={ad.status} />
             <h1 style={{ marginTop: 10 }}>{ad.jobTitle}</h1>
             <div className="biz-name">{ad.businessName} · {ad.businessType}</div>
             {distanceKm != null && <DistanceChip km={distanceKm} />}

             <div className="spec-list">
               <div className="spec-row"><span className="label">Worker category</span><span className="val">{categoryOf(ad)}</span></div>
               <div className="spec-row"><span className="label">Workers needed</span><span className="val">{ad.numWorkers}</span></div>
               <div className="spec-row"><span className="label">Salary</span><span className="val">{ad.salary ? `₹ ${ad.salary}` : 'Negotiable'}</span></div>
               <div className="spec-row"><span className="label">Education</span><span className="val">{ad.education || '—'}</span></div>
               <div className="spec-row"><span className="label">Experience</span><span className="val">{ad.experience || '—'}</span></div>
               <div className="spec-row"><span className="label">Working hours</span><span className="val">{ad.workingHours || '—'}</span></div>
               <div className="spec-row"><span className="label">Contact</span><span className="val">{ad.contactPhone || 'See description'}</span></div>
               <div className="spec-row"><span className="label">Posted</span><span className="val">{new Date(ad.postedAt).toLocaleDateString()}</span></div>
             </div>

             {ad.status === 'active' && !isOwner && (
               <div className="action-row">
                 <button className={`btn ${saved ? 'btn-success' : 'btn-outline'} btn-block`} onClick={toggleSave}>
                   {saved ? '✓ Saved' : '☆ Save advertisement'}
                 </button>
               </div>
             )}
             {ad.status === 'active' && !isOwner && (
               <button className="btn btn-outline btn-block" style={{ marginTop: 10, color: 'var(--danger)' }} onClick={() => user ? setReportOpen(true) : navigate('login', { redirectTo: 'home' })}>
                 🚩 Report this advertisement
               </button>
             )}
           </div>
         </div>

         {reportOpen && (
           <ReportModal
             adId={ad.adId}
             onClose={() => setReportOpen(false)}
             onSubmitted={() => { setReportOpen(false); toast('Report submitted. Our admin team will review it.', 'success'); }}
           />
         )}

         <Lightbox
           images={images}
           index={lightboxIndex}
           onClose={() => setLightboxIndex(null)}
           onNav={(dir) => setLightboxIndex((i) => (i + dir + images.length) % images.length)}
         />
       </div>
     );
   }

   function ReportModal({ adId, onClose, onSubmitted }) {
     const { user } = useAuth();
     const [reason, setReason] = useState('');
     const [description, setDescription] = useState('');
     const [submitting, setSubmitting] = useState(false);
     const [error, setError] = useState(null);

     const submit = async () => {
       if (!reason) { setError('Please select a reason.'); return; }
       setSubmitting(true); setError(null);
       try {
         await apiCall('submitReport', { adId, userId: user.userId, userName: user.name, reason, description });
         onSubmitted();
       } catch (err) { setError(err.message); } finally { setSubmitting(false); }
     };

     return (
       <div className="modal-overlay" onClick={onClose}>
         <div className="modal" onClick={(e) => e.stopPropagation()}>
           <div className="modal-head">
             <h2>Report advertisement</h2>
             <button className="modal-close" onClick={onClose}>✕</button>
           </div>
           <p style={{ color: 'var(--text-mute)', fontSize: 14 }}>Help us keep the board trustworthy. Tell us what's wrong with this listing.</p>

           <div className="radio-group">
             {REPORT_REASONS.map((r) => (
               <label key={r} className={`radio-option ${reason === r ? 'selected' : ''}`}>
                 <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
                 {r}
               </label>
             ))}
           </div>

           <div className="field">
             <label>Additional details (optional)</label>
             <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything else the admin should know..." />
           </div>

           {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
           <button className="btn btn-danger btn-block" disabled={submitting} onClick={submit}>
             {submitting ? 'Submitting...' : 'Submit report'}
           </button>
         </div>
       </div>
     );
   }

   // ==============================================================
   // AD FORM PAGE
   // ==============================================================
   const BLANK_FORM = {
     businessName: '', businessType: BUSINESS_TYPES[0], jobTitle: '', workerCategory: WORKER_CATEGORIES[0],
     customCategory: '', numWorkers: 1, salary: '', education: '', experience: '', skills: '', workingHours: '',
     description: '', contactPhone: '', locationLat: null, locationLng: null, locationAddress: ''
   };

   function AdFormPage({ navigate, mode, adId }) {
     const { user } = useAuth();
     const toast = useToast();
     const isEdit = mode === 'edit';
     const [form, setForm] = useState(BLANK_FORM);
     const [images, setImages] = useState([]);
     const [submitting, setSubmitting] = useState(false);
     const [error, setError] = useState(null);
     const [loading, setLoading] = useState(isEdit);
     const [notFoundOrForbidden, setNotFoundOrForbidden] = useState(false);

     useEffect(() => {
       if (!isEdit) return;
       apiCall('getAdById', { adId }).then((data) => {
         const ad = data.ad;
         if (ad.postedBy !== user.userId) { setNotFoundOrForbidden(true); setLoading(false); return; }
         setForm({
           businessName: ad.businessName || '', businessType: ad.businessType || BUSINESS_TYPES[0],
           jobTitle: ad.jobTitle || '', workerCategory: ad.workerCategory || WORKER_CATEGORIES[0],
           customCategory: ad.customCategory || '', numWorkers: ad.numWorkers || 1, salary: ad.salary || '',
           education: ad.education || '', experience: ad.experience || '', skills: ad.skills || '',
           workingHours: ad.workingHours || '', description: ad.description || '', contactPhone: ad.contactPhone || '',
           locationLat: ad.locationLat, locationLng: ad.locationLng, locationAddress: ad.locationAddress || ''
         });
         setImages(ad.images || []);
         setLoading(false);
       }).catch(() => { setNotFoundOrForbidden(true); setLoading(false); });
     }, [isEdit, adId, user.userId]);

     const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

     const submit = async (e) => {
       e.preventDefault();
       if (!form.businessName || !form.jobTitle) { setError('Business name and job title are required.'); return; }
       if (form.workerCategory === 'Other' && !form.customCategory.trim()) {
         setError('Please describe the worker category.'); return;
       }
       setSubmitting(true); setError(null);
       try {
         if (isEdit) {
           await apiCall('updateAd', { ...form, images, adId, postedBy: user.userId });
           toast('Advertisement updated.', 'success');
           navigate('details', { adId });
         } else {
           await apiCall('createAd', { ...form, images, postedBy: user.userId, postedByName: user.name });
           toast('Advertisement posted successfully!', 'success');
           navigate('home');
         }
       } catch (err) { setError(err.message); } finally { setSubmitting(false); }
     };

     if (loading) return <div className="container"><Spinner label="Loading advertisement..." /></div>;
     if (notFoundOrForbidden) return <div className="container"><ErrorState message="You can't edit this advertisement." onRetry={() => navigate('dashboard')} /></div>;

     return (
       <div className="container form-page">
         <h1>{isEdit ? 'Edit your requirement' : 'Post a worker requirement'}</h1>
         <p style={{ color: 'var(--text-mute)', marginBottom: 24 }}>
           {isEdit ? 'Update the details below — changes go live immediately.' : 'Reach local job seekers directly — free to post.'}
         </p>

         <form className="card" onSubmit={submit}>
           <div className="form-section-title">Business / workplace details</div>
           <div className="form-grid">
             <div className="field"><label>Business / workplace name *</label>
               <input value={form.businessName} onChange={(e) => set('businessName', e.target.value)} placeholder="e.g. Shree Textiles Pvt. Ltd." /></div>
             <div className="field"><label>Business type</label>
               <select value={form.businessType} onChange={(e) => set('businessType', e.target.value)}>
                 {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
               </select></div>
             <div className="field full"><label>Contact phone</label>
               <input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="10-digit mobile number" /></div>
           </div>

           <div className="form-section-title">Job details</div>
           <div className="form-grid">
             <div className="field"><label>Job title *</label>
               <input value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} placeholder="e.g. Machine Operator" /></div>
             <div className="field"><label>Worker category</label>
               <select value={form.workerCategory} onChange={(e) => set('workerCategory', e.target.value)}>
                 {WORKER_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
               </select></div>
             {form.workerCategory === 'Other' && (
               <div className="field full custom-category-field">
                 <label>What kind of worker are you looking for? *</label>
                 <input value={form.customCategory} onChange={(e) => set('customCategory', e.target.value)} placeholder="Describe the worker category, e.g. Gardener, Painter, Data Entry" />
               </div>
             )}
             <div className="field"><label>Number of workers needed</label>
               <input type="number" min="1" value={form.numWorkers} onChange={(e) => set('numWorkers', e.target.value)} /></div>
             <div className="field"><label>Salary (monthly, ₹)</label>
               <input value={form.salary} onChange={(e) => set('salary', e.target.value)} placeholder="e.g. 12000-15000" /></div>
             <div className="field"><label>Education requirement</label>
               <input value={form.education} onChange={(e) => set('education', e.target.value)} placeholder="e.g. 10th pass / none" /></div>
             <div className="field"><label>Experience required</label>
               <input value={form.experience} onChange={(e) => set('experience', e.target.value)} placeholder="e.g. 1+ years / freshers ok" /></div>
             <div className="field"><label>Working hours</label>
               <input value={form.workingHours} onChange={(e) => set('workingHours', e.target.value)} placeholder="e.g. 9 AM - 6 PM, 6 days/week" /></div>
             <div className="field"><label>Skills required</label>
               <input value={form.skills} onChange={(e) => set('skills', e.target.value)} placeholder="e.g. stitching, ironing" /></div>
             <div className="field full"><label>Description</label>
               <textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Describe the role, responsibilities and any other details..." /></div>
           </div>

           <div className="form-section-title">Workplace photos</div>
           <ImageUploader images={images} onChange={setImages} />

           <div className="form-section-title">Workplace location</div>
           <LocationPicker
             lat={form.locationLat} lng={form.locationLng} address={form.locationAddress}
             onChange={(lat, lng, address) => setForm((f) => ({ ...f, locationLat: lat, locationLng: lng, locationAddress: address }))}
           />

           {error && <div className="error-box" style={{ marginTop: 18 }}>{error}</div>}
           <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
             <button className="btn btn-primary btn-block" disabled={submitting}>
               {submitting ? 'Saving...' : (isEdit ? 'Save changes' : 'Post advertisement')}
             </button>
             {isEdit && <button type="button" className="btn btn-outline" onClick={() => navigate('details', { adId })}>Cancel</button>}
           </div>
         </form>
       </div>
     );
   }

   // ------------------------------------------------------------
   // IMAGE UPLOADER
   // ------------------------------------------------------------
   function ImageUploader({ images, onChange }) {
     const [dragOver, setDragOver] = useState(false);
     const [uploading, setUploading] = useState([]);
     const inputRef = useRef(null);

     const handleFiles = async (files) => {
       const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
       for (const file of list) {
         const tempId = 'u' + Math.random().toString(36).slice(2);
         setUploading((u) => [...u, tempId]);
         try {
           const url = await uploadToCloudinary(file);
           onChange((prev) => [...prev, url]);
         } catch (err) {
           alert('Image upload failed: ' + err.message);
         } finally {
           setUploading((u) => u.filter((id) => id !== tempId));
         }
       }
     };

     const removeImage = (idx) => onChange((prev) => prev.filter((_, i) => i !== idx));

     return (
       <div>
         <div
           className={`dropzone ${dragOver ? 'dragover' : ''}`}
           onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
           onDragLeave={() => setDragOver(false)}
           onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
           onClick={() => inputRef.current.click()}
         >
           <div><strong>Drag & drop photos here</strong>, or click to browse</div>
           <div style={{ fontSize: 12, marginTop: 4 }}>Workplace / factory floor / shop front photos help build trust. You can add several.</div>
           <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
         </div>
         {(images.length > 0 || uploading.length > 0) && (
           <div className="image-preview-grid">
             {images.map((src, i) => (
               <div className="image-preview" key={src}>
                 <img src={src} alt={`Upload ${i + 1}`} />
                 <button type="button" className="remove-btn" onClick={() => removeImage(i)}>✕</button>
               </div>
             ))}
             {uploading.map((id) => (
               <div className="image-preview" key={id}>
                 <div className="uploading-overlay"><div className="spinner" style={{ width: 20, height: 20, marginBottom: 0 }}></div></div>
               </div>
             ))}
           </div>
         )}
       </div>
     );
   }

   // ------------------------------------------------------------
   // LOCATION PICKER
   // ------------------------------------------------------------
   function LocationPicker({ lat, lng, address, onChange }) {
     const [localAddress, setLocalAddress] = useState(address || '');
     const [coords, setCoords] = useState({ lat: lat || null, lng: lng || null });
     const [locating, setLocating] = useState(false);

     useEffect(() => { setLocalAddress(address || ''); }, [address]);
     useEffect(() => { setCoords({ lat: lat || null, lng: lng || null }); }, [lat, lng]);

     const handlePick = (la, ln) => {
       setCoords({ lat: la, lng: ln });
       onChange(la, ln, localAddress);
     };

     const useCurrentLocation = () => {
       if (!navigator.geolocation) { alert('Geolocation is not supported by this browser.'); return; }
       setLocating(true);
       navigator.geolocation.getCurrentPosition(
         (pos) => {
           const { latitude, longitude } = pos.coords;
           setCoords({ lat: latitude, lng: longitude });
           onChange(latitude, longitude, localAddress);
           setLocating(false);
         },
         () => { alert('Could not fetch current location. Please pick it on the map instead.'); setLocating(false); },
         { enableHighAccuracy: true, timeout: 10000 }
       );
     };

     return (
       <div>
         <div className="map-toolbar">
           <button type="button" className="btn btn-outline btn-sm" onClick={useCurrentLocation} disabled={locating}>
             {locating ? 'Locating…' : '📍 Use current location'}
           </button>
           <span className="map-coords">
             {coords.lat ? `Lat ${coords.lat.toFixed(5)}, Lng ${coords.lng.toFixed(5)}` : 'Click on the map or drag the pin to set the workplace location'}
           </span>
         </div>
         <div className="map-wrap">
           <MapView lat={coords.lat} lng={coords.lng} interactive markerDraggable onPick={handlePick} height="300px" />
         </div>
         <div className="field" style={{ marginTop: 12 }}>
           <label>Address / landmark</label>
           <input
             value={localAddress}
             onChange={(e) => { setLocalAddress(e.target.value); onChange(coords.lat, coords.lng, e.target.value); }}
             placeholder="e.g. Near Bus Stand, Industrial Area Phase 2"
           />
         </div>
       </div>
     );
   }

   // ==============================================================
   // USER DASHBOARD
   // ==============================================================
   function UserDashboardPage({ navigate }) {
     const { user } = useAuth();
     const [tab, setTab] = useState('myads');

     return (
       <div className="container form-page" style={{ maxWidth: 1000 }}>
         <h1>My dashboard</h1>
         <p style={{ color: 'var(--text-mute)', marginBottom: 20 }}>Welcome back, {user.name}.</p>

         <div className="tabs">
           <button className={`tab ${tab === 'myads' ? 'active' : ''}`} onClick={() => setTab('myads')}>My posted ads</button>
           <button className={`tab ${tab === 'saved' ? 'active' : ''}`} onClick={() => setTab('saved')}>Saved advertisements</button>

           <button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>My reports</button>
         </div>

         {tab === 'myads' && <MyAdsTab navigate={navigate} />}
         {tab === 'saved' && <SavedAdsTab navigate={navigate} />}
         {tab === 'applied' && <AppliedJobsTab navigate={navigate} />}
         {tab === 'reports' && <MyReportsTab />}
       </div>
     );
   }

   function SavedAdsTab({ navigate }) {
     const { user } = useAuth();
     const toast = useToast();
     const [ads, setAds] = useState(null);
     const [error, setError] = useState(null);

     const load = useCallback(() => {
       setAds(null); setError(null);
       apiCall('getSavedAds', { userId: user.userId }).then((d) => setAds(d.ads)).catch((e) => setError(e.message));
     }, [user.userId]);

     useEffect(() => { load(); }, [load]);

     const unsave = async (adId) => {
       try { await apiCall('removeSavedAd', { userId: user.userId, adId }); toast('Removed from saved.', 'success'); load(); }
       catch (err) { toast(err.message, 'error'); }
     };

     if (ads === null && !error) return <Spinner label="Loading saved advertisements..." />;
     if (error) return <ErrorState message={error} onRetry={load} />;
     if (ads.length === 0) return <EmptyState icon="⭐" title="No saved advertisements yet" message="Save listings you're interested in to find them here later." />;

     return (
       <div className="grid">
         {ads.map((ad) => (
           <div key={ad.adId}>
             <AdCard ad={ad} onClick={() => navigate('details', { adId: ad.adId })} />
             <button className="btn btn-outline btn-sm btn-block" style={{ marginTop: 8 }} onClick={() => unsave(ad.adId)}>Remove from saved</button>
           </div>
         ))}
       </div>
     );
   }

   function AppliedJobsTab({ navigate }) {
     const { user } = useAuth();
     const [ads, setAds] = useState(null);
     const [error, setError] = useState(null);

     useEffect(() => {
       apiCall('getAppliedAds', { userId: user.userId }).then((d) => setAds(d.ads)).catch((e) => setError(e.message));
     }, [user.userId]);

     if (ads === null && !error) return <Spinner label="Loading applied jobs..." />;
     if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
     if (ads.length === 0) return <EmptyState icon="📋" title="No applications yet" message="Apply to jobs to track them here." />;

     return (
       <div className="grid">
         {ads.map((ad) => <AdCard key={ad.adId} ad={ad} onClick={() => navigate('details', { adId: ad.adId })} />)}
       </div>
     );
   }

   function MyAdsTab({ navigate }) {
     const { user } = useAuth();
     const toast = useToast();
     const [ads, setAds] = useState(null);
     const [error, setError] = useState(null);
     const [busyId, setBusyId] = useState(null);

     const load = useCallback(() => {
       setAds(null); setError(null);
       apiCall('getMyAds', { userId: user.userId }).then((d) => setAds(d.ads)).catch((e) => setError(e.message));
     }, [user.userId]);

     useEffect(() => { load(); }, [load]);

     const toggleStatus = async (ad) => {
       const nextStatus = ad.status === 'active' ? 'inactive' : 'active';
       setBusyId(ad.adId);
       try {
         await apiCall('toggleAdStatus', { adId: ad.adId, userId: user.userId, status: nextStatus });
         toast(nextStatus === 'active' ? 'Advertisement reactivated.' : 'Advertisement paused.', 'success');
         load();
       } catch (err) { toast(err.message, 'error'); } finally { setBusyId(null); }
     };

     const remove = async (ad) => {
       if (!window.confirm(`Delete "${ad.jobTitle}" permanently? This can't be undone.`)) return;
       setBusyId(ad.adId);
       try {
         await apiCall('deleteAd', { adId: ad.adId, userId: user.userId });
         toast('Advertisement deleted.', 'success');
         load();
       } catch (err) { toast(err.message, 'error'); } finally { setBusyId(null); }
     };

     if (ads === null && !error) return <Spinner label="Loading your advertisements..." />;
     if (error) return <ErrorState message={error} onRetry={load} />;
     if (ads.length === 0) return (
       <EmptyState icon="🏭" title="You haven't posted any requirements yet" message="Post a worker requirement to reach local job seekers." />
     );

     return (
       <div className="grid">
         {ads.map((ad) => (
           <div key={ad.adId} className="my-ad-card">
             <AdCard ad={ad} onClick={() => navigate('details', { adId: ad.adId })} />
             <div className="my-ad-actions">
               <button className="btn btn-outline btn-sm" onClick={() => navigate('edit', { adId: ad.adId })} disabled={ad.status === 'taken_down'}>✎ Edit</button>
               {ad.status !== 'taken_down' && (
                 <button className="btn btn-outline btn-sm" disabled={busyId === ad.adId} onClick={() => toggleStatus(ad)}>
                   {ad.status === 'active' ? '⏸ Pause' : '▶ Activate'}
                 </button>
               )}
               <button className="btn btn-danger btn-sm" disabled={busyId === ad.adId} onClick={() => remove(ad)}>🗑 Delete</button>
             </div>
           </div>
         ))}
       </div>
     );
   }

   function MyReportsTab() {
     const { user } = useAuth();
     const [reports, setReports] = useState(null);
     const [error, setError] = useState(null);

     const load = useCallback(() => {
       setReports(null); setError(null);
       apiCall('getUserReports', { userId: user.userId }).then((d) => setReports(d.reports)).catch((e) => setError(e.message));
     }, [user.userId]);

     useEffect(() => { load(); }, [load]);

     if (reports === null && !error) return <Spinner label="Loading your reports..." />;
     if (error) return <ErrorState message={error} onRetry={load} />;
     if (reports.length === 0) return <EmptyState icon="🚩" title="No reports submitted" message="Reports you file on misleading advertisements will show up here." />;

     return (
       <div className="table-wrap">
         <table>
           <thead><tr><th>Advertisement</th><th>Reason</th><th>Status</th><th>Reported on</th></tr></thead>
           <tbody>
             {reports.map((r) => (
               <tr key={r.reportId}>
                 <td><strong>{r.adTitle}</strong><br /><span style={{ color: 'var(--text-mute)', fontSize: 12 }}>{r.adBusinessName}</span></td>
                 <td>{r.reason}</td>
                 <td><StatusBadge status={r.status} /></td>
                 <td className="mono">{new Date(r.reportedAt).toLocaleDateString()}</td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>
     );
   }

   // ==============================================================
   // ADMIN DASHBOARD
   // ==============================================================
   function AdminDashboardPage() {
     const [tab, setTab] = useState('overview');
     return (
       <div className="container form-page" style={{ maxWidth: 1100 }}>
         <h1>Admin dashboard</h1>
         <div className="tabs">
           <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
           <button className={`tab ${tab === 'ads' ? 'active' : ''}`} onClick={() => setTab('ads')}>Advertisements</button>
           <button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>Reports</button>
           <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users</button>
         </div>
         {tab === 'overview' && <AdminOverviewTab />}
         {tab === 'ads' && <AdminAdsTab />}
         {tab === 'reports' && <AdminReportsTab />}
         {tab === 'users' && <AdminUsersTab />}
       </div>
     );
   }

   function AdminOverviewTab() {
     const { user } = useAuth();
     const [stats, setStats] = useState(null);
     const [error, setError] = useState(null);

     useEffect(() => {
       apiCall('getDashboardStats', { adminId: user.userId }).then((d) => setStats(d.stats)).catch((e) => setError(e.message));
     }, [user.userId]);

     if (error) return <ErrorState message={error} />;
     if (!stats) return <Spinner label="Loading stats..." />;

     return (
       <div>
         <div className="stats-grid">
           <div className="stat-card amber"><div className="num">{stats.activeAds}</div><div className="lbl">Active ads</div></div>
           <div className="stat-card"><div className="num">{stats.inactiveAds}</div><div className="lbl">Paused ads</div></div>
           <div className="stat-card danger"><div className="num">{stats.takenDownAds}</div><div className="lbl">Taken down</div></div>
           <div className="stat-card"><div className="num">{stats.totalAds}</div><div className="lbl">Total ads posted</div></div>
           <div className="stat-card success"><div className="num">{stats.totalWorkersRequested}</div><div className="lbl">Workers currently sought</div></div>
           <div className="stat-card"><div className="num">{stats.totalUsers}</div><div className="lbl">Registered users</div></div>
           <div className="stat-card danger"><div className="num">{stats.pendingReports}</div><div className="lbl">Pending reports</div></div>
         </div>
         <h3>Requirements by category</h3>
         <div className="table-wrap">
           <table>
             <thead><tr><th>Category</th><th>Active listings</th></tr></thead>
             <tbody>
               {Object.entries(stats.categoryCounts).map(([cat, count]) => (
                 <tr key={cat}><td>{cat}</td><td>{count}</td></tr>
               ))}
             </tbody>
           </table>
         </div>
       </div>
     );
   }

   function AdminAdsTab() {
     const { user } = useAuth();
     const toast = useToast();
     const [ads, setAds] = useState(null);
     const [error, setError] = useState(null);

     const load = useCallback(() => {
       setAds(null); setError(null);
       apiCall('getAllAds', { adminId: user.userId }).then((d) => setAds(d.ads)).catch((e) => setError(e.message));
     }, [user.userId]);

     useEffect(() => { load(); }, [load]);

     const takedown = async (adId) => {
       const reason = prompt('Reason for takedown (shown to users):', 'This listing was found to be misleading.');
       if (reason === null) return;
       try { await apiCall('takedownAd', { adminId: user.userId, adId, takedownReason: reason }); toast('Advertisement taken down.', 'success'); load(); }
       catch (err) { toast(err.message, 'error'); }
     };
     const restore = async (adId) => {
       try { await apiCall('restoreAd', { adminId: user.userId, adId }); toast('Advertisement restored.', 'success'); load(); }
       catch (err) { toast(err.message, 'error'); }
     };

     if (ads === null && !error) return <Spinner label="Loading advertisements..." />;
     if (error) return <ErrorState message={error} onRetry={load} />;

     return (
       <div className="table-wrap">
         <table>
           <thead><tr><th>Job title</th><th>Business</th><th>Category</th><th>Status</th><th>Posted</th><th>Actions</th></tr></thead>
           <tbody>
             {ads.map((ad) => (
               <tr key={ad.adId}>
                 <td>{ad.jobTitle}</td>
                 <td>{ad.businessName}</td>
                 <td>{categoryOf(ad)}</td>
                 <td><StatusBadge status={ad.status} /></td>
                 <td className="mono">{new Date(ad.postedAt).toLocaleDateString()}</td>
                 <td className="row-actions">
                   {ad.status !== 'taken_down'
                     ? <button className="btn btn-danger btn-sm" onClick={() => takedown(ad.adId)}>Take down</button>
                     : <button className="btn btn-success btn-sm" onClick={() => restore(ad.adId)}>Restore</button>}
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>
     );
   }

   function AdminReportsTab() {
     const { user } = useAuth();
     const toast = useToast();
     const [reports, setReports] = useState(null);
     const [error, setError] = useState(null);
     const [reviewing, setReviewing] = useState(null);

     const load = useCallback(() => {
       setReports(null); setError(null);
       apiCall('getAllReports', { adminId: user.userId }).then((d) => setReports(d.reports)).catch((e) => setError(e.message));
     }, [user.userId]);

     useEffect(() => { load(); }, [load]);

     if (reports === null && !error) return <Spinner label="Loading reports..." />;
     if (error) return <ErrorState message={error} onRetry={load} />;
     if (reports.length === 0) return <EmptyState icon="✅" title="No reports" message="No advertisements have been reported yet." />;

     return (
       <div>
         <div className="table-wrap">
           <table>
             <thead><tr><th>Advertisement</th><th>Reported by</th><th>Reason</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
             <tbody>
               {reports.map((r) => (
                 <tr key={r.reportId}>
                   <td>{r.ad ? r.ad.jobTitle : '(removed)'} <br /><span style={{ fontSize: 12, color: 'var(--text-mute)' }}>{r.ad ? r.ad.businessName : ''}</span></td>
                   <td>{r.userName}</td>
                   <td>{r.reason}</td>
                   <td><StatusBadge status={r.status} /></td>
                   <td className="mono">{new Date(r.reportedAt).toLocaleDateString()}</td>
                   <td className="row-actions">
                     <button className="btn btn-outline btn-sm" onClick={() => setReviewing(r)}>Review</button>
                   </td>
                 </tr>
               ))}
             </tbody>
           </table>
         </div>
         {reviewing && <AdminReviewModal report={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); load(); toast('Report reviewed.', 'success'); }} />}
       </div>
     );
   }

   function AdminReviewModal({ report, onClose, onDone }) {
     const { user } = useAuth();
     const [note, setNote] = useState('');
     const [busy, setBusy] = useState(false);
     const [error, setError] = useState(null);

     const decide = async (decision) => {
       setBusy(true); setError(null);
       try {
         await apiCall('reviewReport', {
           adminId: user.userId, reportId: report.reportId, adId: report.adId,
           decision, reviewNote: note
         });
         onDone();
       } catch (err) { setError(err.message); } finally { setBusy(false); }
     };

     return (
       <div className="modal-overlay" onClick={onClose}>
         <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
           <div className="modal-head"><h2>Review report</h2><button className="modal-close" onClick={onClose}>✕</button></div>

           {report.ad ? (
             <div className="spec-list">
               <div className="spec-row"><span className="label">Job title</span><span className="val">{report.ad.jobTitle}</span></div>
               <div className="spec-row"><span className="label">Business</span><span className="val">{report.ad.businessName}</span></div>
               <div className="spec-row"><span className="label">Ad status</span><span className="val"><StatusBadge status={report.ad.status} /></span></div>
             </div>
           ) : <p style={{ color: 'var(--text-mute)' }}>This advertisement has already been removed.</p>}

           <div className="form-section-title">Report details</div>
           <div className="spec-list">
             <div className="spec-row"><span className="label">Reported by</span><span className="val">{report.userName}</span></div>
             <div className="spec-row"><span className="label">Reason</span><span className="val">{report.reason}</span></div>
           </div>
           {report.description && <p style={{ fontSize: 14 }}>"{report.description}"</p>}

           <div className="field" style={{ marginTop: 14 }}>
             <label>Admin note (optional, shown internally)</label>
             <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note about this decision..." />
           </div>

           {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
           <div style={{ display: 'flex', gap: 10 }}>
             <button className="btn btn-outline btn-block" disabled={busy} onClick={() => decide('dismiss')}>Dismiss report</button>
             <button className="btn btn-danger btn-block" disabled={busy || !report.ad} onClick={() => decide('takedown')}>Take down ad</button>
           </div>
         </div>
       </div>
     );
   }

   function AdminUsersTab() {
     const { user } = useAuth();
     const [users, setUsers] = useState(null);
     const [error, setError] = useState(null);

     useEffect(() => {
       apiCall('getAllUsers', { adminId: user.userId }).then((d) => setUsers(d.users)).catch((e) => setError(e.message));
     }, [user.userId]);

     if (error) return <ErrorState message={error} />;
     if (!users) return <Spinner label="Loading users..." />;

     return (
       <div className="table-wrap">
         <table>
           <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th></tr></thead>
           <tbody>
             {users.map((u) => (
               <tr key={u.userId}>
                 <td>{u.name}</td><td>{u.email}</td><td>{u.phone || '—'}</td>
                 <td>{u.role === 'admin' ? <span className="badge badge-admin">Admin</span> : 'User'}</td>
                 <td className="mono">{new Date(u.createdAt).toLocaleDateString()}</td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>
     );
   }

   // ==============================================================
   // LOGIN / REGISTER PAGE
   // ==============================================================
   function LoginPage({ navigate, initialMode, redirectTo }) {
     const { login } = useAuth();
     const toast = useToast();
     const [mode, setMode] = useState(initialMode || 'login');
     const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
     const [busy, setBusy] = useState(false);
     const [error, setError] = useState(null);

     const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

     const submit = async (e) => {
       e.preventDefault();
       setBusy(true); setError(null);
       try {
         const data = mode === 'login'
           ? await apiCall('login', { email: form.email, password: form.password })
           : await apiCall('register', form);
         login(data.user);
         toast(mode === 'login' ? `Welcome back, ${data.user.name}.` : 'Account created — welcome!', 'success');
         navigate(redirectTo || 'home');
       } catch (err) { setError(err.message); } finally { setBusy(false); }
     };

     return (
       <div className="auth-wrap">
         <div className="auth-card">
           <h2>{mode === 'login' ? 'Log in' : 'Create your account'}</h2>
           <div className="sub">{mode === 'login' ? 'Access your dashboard and saved jobs.' : 'Post job requirements or apply to local jobs.'}</div>
           <form onSubmit={submit}>
             {mode === 'register' && (
               <div className="field"><label>Full name</label><input required value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
             )}
             <div className="field"><label>Email</label><input required type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
             {mode === 'register' && (
               <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
             )}
             <div className="field"><label>Password</label><input required type="password" value={form.password} onChange={(e) => set('password', e.target.value)} /></div>

             {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}
             <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Please wait...' : (mode === 'login' ? 'Log in' : 'Sign up')}</button>
           </form>
           <div className="auth-switch">
             {mode === 'login'
               ? <>New here? <button onClick={() => setMode('register')}>Create an account</button></>
               : <>Already have an account? <button onClick={() => setMode('login')}>Log in</button></>}
           </div>
         </div>
       </div>
     );
   }

   // ==============================================================
   // EXPORT
   // ==============================================================
   export default App;