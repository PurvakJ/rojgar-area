/* ==========================================================
   Rojgar AREA — Frontend (Enhanced v6)
   Plain React 18 + Babel-standalone (no build step).
   Backend: Google Apps Script Web App (Code.gs)
   Images:  Cloudinary unsigned upload
   Map:     Leaflet + OpenStreetMap tiles (no API key needed)

   NEW IN THIS VERSION (v6):
   - "Browse Jobs" and "Find Workers" no longer show a permanent
     filter sidebar. Filters now live inside a hamburger-triggered
     slide-in drawer, opened with a "☰ Filters" button next to the
     page heading — same filter fields, just tucked away until
     needed, so results get the full width and the page feels
     less cluttered.
   - "My Dashboard" section switcher (My posted ads / Saved
     advertisements / My reports / My Profile) now also opens
     from a "☰ Menu" hamburger drawer instead of a row of tabs.
   - My Dashboard now opens on "Saved advertisements" by default
     for worker-only accounts (who can't post ads), and on
     "My posted ads" for business/both/admin accounts.

   CARRIED OVER FROM v5:
   - Worker profile: phone number is now MANDATORY for worker/both
     accounts (enforced client-side in "My Profile" and server-side in
     updateWorkerProfile), and is shown on every worker card and on the
     worker's public profile page so businesses in "Find Workers" can
     always reach them.
   - Worker profile: optional public email field (separate from the
     login email), optional profile photo (shown as a circular avatar;
     falls back to a generic person icon when not set), and optional
     multi-image "resume" upload (photos of a resume / certificates /
     ID proof) — all via the same Cloudinary unsigned upload used for
     advertisement photos.
   - Worker profile page and Worker Browse cards now show a
     "Get Directions" button / the worker's phone number next to a
     WhatsApp button, mirroring the advertisement details page.
   - Advertisement details page now shows the contact phone number as
     a tappable "Call" link right next to the WhatsApp button.
   - Footer buttons are now all functional: Privacy Policy, Terms of
     Service and Cookie Policy open an in-app modal with real content,
     and a new "Contact Developer" / "About Us" action opens a modal
     with the developer's logo, email and website.

   CARRIED OVER FROM v4:
   - Three-role permission model, same login for everyone (worker /
     business / both / admin). Posting is gated with canPostAds(user)
     in the nav, in routing, and server-side in createAd.
   - "My Profile" requires a dropped map pin before saving a
     worker/both profile (an address alone is not enough for
     "Workers near you" to find you).
   - Admin can suspend/restore a worker or business profile.
   - Workers have a real location (lat/lng/address), settable from
     "My Profile". Workers Browse page mirrors the Jobs Browse page:
     location banner, radius filter, nearest-first sort, distance chip.
   - Worker profiles (create/edit, browse, view + review)
   - Reviews & star ratings (businesses <-> workers)
   - WhatsApp "Apply Now" deep link
   - Urgent / "Hiring Today" jobs
   - Salary benchmarking hint on the post form
   - Verified badge (admin-controlled)
   - Referral codes
   - EN / Hindi / Punjabi language switch

   IMAGE UPLOAD ("Unknown API key" error):
   - Image uploads go straight from the browser to Cloudinary using
     CONFIG.CLOUDINARY below. "Unknown API key" / "Unknown API key" is
     a Cloudinary-side error, not an Apps Script error — it means
     cloudName and/or uploadPreset don't match a real Cloudinary
     account, OR the upload preset exists but is not set to
     "Unsigned" (Cloudinary Dashboard > Settings > Upload > Upload
     presets). Fix by replacing BOTH values below with your own
     Cloudinary cloud name and an unsigned upload preset you created.
   ========================================================== */
   import React, { useState, useEffect, useRef, useContext, createContext, useCallback, useMemo,} from 'react';
   import './App.css';
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
     APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzIBikVtx2QBDPnb4Hou8RrLFADWKK7Iswy1ArxkXeDidH0vgs8XQQLBVwAYWSQO5Ys/exec',
     CLOUDINARY: {
       // TODO: replace with YOUR Cloudinary cloud name (Dashboard, top-left)
       // and an UNSIGNED upload preset you created for this project.
       // The current values below are almost certainly wrong for your
       // account, which is why uploads fail with "Unknown API key".
       cloudName: 'dm9gg8yss',
       uploadPreset: 'images'
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
   
   const USER_TYPES = [
     { value: 'worker', label: 'Job Seeker (Worker)' },
     { value: 'business', label: 'Business / Employer' },
     { value: 'both', label: 'Both' }
   ];
   
   // Icons for worker categories
   const CATEGORY_ICONS = {
     'Skilled Labour': '🔧', 'Unskilled Labour': '💪', 'Driver': '🚗', 'Electrician': '⚡',
     'Plumber': '🔧', 'Mason': '🏗️', 'Welder': '🔥', 'Machine Operator': '🔩',
     'Helper': '🤝', 'Security Guard': '🛡️', 'Tailor / Stitching': '🧵', 'Packing Staff': '📦',
     'Delivery Staff': '🛵', 'Housekeeping': '🧹', 'Cook / Kitchen Staff': '👨‍🍳', 'Other': '📋'
   };
   
   // Enhanced category images for hero section
   const CATEGORY_IMAGES = {
     'Skilled Labour': 'https://images.unsplash.com/photo-1581091226033-d5c48150dbaa?w=400&h=300&fit=crop',
     'Driver': 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=400&h=300&fit=crop',
     'Electrician': 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=400&h=300&fit=crop',
     'Plumber': 'https://images.unsplash.com/photo-1607472586893-edb57bcf0e39?w=400&h=300&fit=crop',
     'Mason': 'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?w=400&h=300&fit=crop',
     'Welder': 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=400&h=300&fit=crop',
     'Security Guard': 'https://images.unsplash.com/photo-1582139329536-e7284fece509?w=400&h=300&fit=crop',
     'Cook / Kitchen Staff': 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=400&h=300&fit=crop'
   };
   
   // ------------------------------------------------------------
   // I18N — English / Hindi / Punjabi
   // ------------------------------------------------------------
   const LANGUAGES = [
     { code: 'en', label: 'English' },
     { code: 'hi', label: 'हिंदी' },
     { code: 'pa', label: 'ਪੰਜਾਬੀ' }
   ];
   
   const I18N = {
     en: {
       home: 'Home', browseJobs: 'Browse Jobs', postRequirement: 'Post a Requirement',
       findWorkers: 'Find Workers', myDashboard: 'My Dashboard', admin: 'Admin',
       login: 'Log in', signup: 'Sign up', logout: 'Log out',
       heroTitle: 'Find jobs near you — posted directly by local businesses',
       heroSubtitle: 'Discover worker requirements from factories, shops, restaurants, and workshops in your area. No middlemen, direct connection.',
       searchPlaceholder: 'Search job title, skill, or business...',
       locationPlaceholder: 'Enter your location',
       searchJobs: 'Search Jobs', findJobsNearMe: '📍 Find Jobs Near Me',
       popularCategories: 'Popular Job Categories', howItWorks: 'How It Works',
       urgentHiring: '🔥 Hiring Today — Urgent Requirements',
       viewAll: 'View all →', applyWhatsApp: '💬 Apply on WhatsApp',
       getDirections: '🗺️ Get Directions', save: '☆ Save advertisement', saved: '✓ Saved',
       report: '🚩 Report this advertisement', reviews: 'Reviews', writeReview: 'Write a review',
       verified: 'Verified', workersNearYou: 'Workers near you', availableNow: 'Available now',
       viewProfile: 'View profile', myProfile: 'My Profile', referral: 'Your referral code',
       postAJob: 'Post a worker requirement', salaryBenchmark: 'Typical salary for this category'
     },
     hi: {
       home: 'होम', browseJobs: 'नौकरियां देखें', postRequirement: 'ज़रूरत पोस्ट करें',
       findWorkers: 'कामगार खोजें', myDashboard: 'मेरा डैशबोर्ड', admin: 'एडमिन',
       login: 'लॉग इन', signup: 'साइन अप', logout: 'लॉग आउट',
       heroTitle: 'अपने पास की नौकरियां खोजें — स्थानीय व्यवसायों द्वारा सीधे पोस्ट की गई',
       heroSubtitle: 'अपने क्षेत्र की फैक्ट्रियों, दुकानों, रेस्तरां और वर्कशॉप की जरूरतें खोजें। कोई बिचौलिया नहीं, सीधा संपर्क।',
       searchPlaceholder: 'नौकरी का नाम, कौशल या व्यवसाय खोजें...',
       locationPlaceholder: 'अपना स्थान दर्ज करें',
       searchJobs: 'नौकरियां खोजें', findJobsNearMe: '📍 पास की नौकरियां खोजें',
       popularCategories: 'लोकप्रिय नौकरी श्रेणियां', howItWorks: 'यह कैसे काम करता है',
       urgentHiring: '🔥 आज ही भर्ती — तत्काल जरूरत',
       viewAll: 'सभी देखें →', applyWhatsApp: '💬 व्हाट्सएप पर आवेदन करें',
       getDirections: '🗺️ रास्ता दिखाएं', save: '☆ सेव करें', saved: '✓ सेव किया गया',
       report: '🚩 रिपोर्ट करें', reviews: 'समीक्षाएं', writeReview: 'समीक्षा लिखें',
       verified: 'सत्यापित', workersNearYou: 'आपके पास के कामगार', availableNow: 'अभी उपलब्ध',
       viewProfile: 'प्रोफ़ाइल देखें', myProfile: 'मेरी प्रोफ़ाइल', referral: 'आपका रेफरल कोड',
       postAJob: 'कामगार की जरूरत पोस्ट करें', salaryBenchmark: 'इस श्रेणी के लिए औसत वेतन'
     },
     pa: {
       home: 'ਹੋਮ', browseJobs: 'ਨੌਕਰੀਆਂ ਵੇਖੋ', postRequirement: 'ਲੋੜ ਪੋਸਟ ਕਰੋ',
       findWorkers: 'ਕਾਮੇ ਲੱਭੋ', myDashboard: 'ਮੇਰਾ ਡੈਸ਼ਬੋਰਡ', admin: 'ਐਡਮਿਨ',
       login: 'ਲਾਗਇਨ', signup: 'ਸਾਈਨ ਅੱਪ', logout: 'ਲਾਗਆਉਟ',
       heroTitle: 'ਆਪਣੇ ਨੇੜੇ ਨੌਕਰੀਆਂ ਲੱਭੋ — ਸਥਾਨਕ ਕਾਰੋਬਾਰਾਂ ਦੁਆਰਾ ਸਿੱਧੀਆਂ ਪੋਸਟ ਕੀਤੀਆਂ',
       heroSubtitle: 'ਆਪਣੇ ਖੇਤਰ ਦੀਆਂ ਫੈਕਟਰੀਆਂ, ਦੁਕਾਨਾਂ, ਰੈਸਟੋਰੈਂਟਾਂ ਅਤੇ ਵਰਕਸ਼ਾਪਾਂ ਦੀਆਂ ਲੋੜਾਂ ਲੱਭੋ। ਕੋਈ ਵਿਚੋਲਾ ਨਹੀਂ।',
       searchPlaceholder: 'ਨੌਕਰੀ ਦਾ ਨਾਮ, ਹੁਨਰ ਜਾਂ ਕਾਰੋਬਾਰ ਖੋਜੋ...',
       locationPlaceholder: 'ਆਪਣੀ ਥਾਂ ਦਰਜ ਕਰੋ',
       searchJobs: 'ਨੌਕਰੀਆਂ ਖੋਜੋ', findJobsNearMe: '📍 ਨੇੜੇ ਦੀਆਂ ਨੌਕਰੀਆਂ ਲੱਭੋ',
       popularCategories: 'ਪ੍ਰਸਿੱਧ ਨੌਕਰੀ ਸ਼੍ਰੇਣੀਆਂ', howItWorks: 'ਇਹ ਕਿਵੇਂ ਕੰਮ ਕਰਦਾ ਹੈ',
       urgentHiring: '🔥 ਅੱਜ ਹੀ ਭਰਤੀ — ਜ਼ਰੂਰੀ ਲੋੜ',
       viewAll: 'ਸਾਰੇ ਵੇਖੋ →', applyWhatsApp: '💬 ਵਟਸਐਪ ਤੇ ਅਪਲਾਈ ਕਰੋ',
       getDirections: '🗺️ ਰਸਤਾ ਵੇਖੋ', save: '☆ ਸੇਵ ਕਰੋ', saved: '✓ ਸੇਵ ਕੀਤਾ',
       report: '🚩 ਰਿਪੋਰਟ ਕਰੋ', reviews: 'ਸਮੀਖਿਆਵਾਂ', writeReview: 'ਸਮੀਖਿਆ ਲਿਖੋ',
       verified: 'ਪ੍ਰਮਾਣਿਤ', workersNearYou: 'ਤੁਹਾਡੇ ਨੇੜੇ ਦੇ ਕਾਮੇ', availableNow: 'ਹੁਣ ਉਪਲਬਧ',
       viewProfile: 'ਪ੍ਰੋਫਾਈਲ ਵੇਖੋ', myProfile: 'ਮੇਰੀ ਪ੍ਰੋਫਾਈਲ', referral: 'ਤੁਹਾਡਾ ਰੈਫਰਲ ਕੋਡ',
       postAJob: 'ਕਾਮੇ ਦੀ ਲੋੜ ਪੋਸਟ ਕਰੋ', salaryBenchmark: 'ਇਸ ਸ਼੍ਰੇਣੀ ਲਈ ਔਸਤ ਤਨਖਾਹ'
     }
   };
   
   const LanguageContext = createContext(null);
   const useLanguage = () => useContext(LanguageContext);
   
   function useT() {
     const { lang } = useLanguage();
     return useCallback((key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key, [lang]);
   }
   
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
   
   // Generic — works for any object list with locationLat/locationLng fields
   // (used for both job advertisements AND worker profiles).
   function withDistances(items, userCoords) {
     return items.map((a) => {
       let distanceKm = null;
       if (userCoords && a.locationLat != null && a.locationLng != null) {
         distanceKm = haversineDistanceKm(userCoords.lat, userCoords.lng, a.locationLat, a.locationLng);
       }
       return { ...a, distanceKm };
     });
   }
   
   // Builds a wa.me deep link. Assumes Indian 10-digit mobile numbers by default.
   function buildWhatsAppLink(phone, message) {
     if (!phone) return null;
     let digits = String(phone).replace(/\D/g, '');
     if (digits.length === 10) digits = '91' + digits;
     if (!digits) return null;
     const text = encodeURIComponent(message || 'Hi, I saw your job posting on Rojgar AREA and I am interested.');
     return `https://wa.me/${digits}?text=${text}`;
   }
   
   // Opens Google Maps directions to the given lat/lng. Tries to use the
   // visitor's current position as the origin (silently falls back to a
   // destination-only link if permission is denied or unavailable) —
   // shared by the advertisement details page and the worker profile page.
   function openDirectionsToCoords(lat, lng, onDone) {
     if (lat == null || lng == null) { onDone && onDone(false); return; }
     const go = (originStr) => {
       const destination = `${lat},${lng}`;
       const url = originStr
         ? `https://www.google.com/maps/dir/${originStr}/${destination}`
         : `https://www.google.com/maps/dir//${destination}`;
       window.open(url, '_blank');
       onDone && onDone(true);
     };
     if (navigator.geolocation) {
       navigator.geolocation.getCurrentPosition(
         (pos) => go(`${pos.coords.latitude},${pos.coords.longitude}`),
         () => go(null),
         { enableHighAccuracy: true, timeout: 5000 }
       );
     } else {
       go(null);
     }
   }
   
   // ------------------------------------------------------------
   // ROLE / PERMISSION HELPERS
   // ------------------------------------------------------------
   // Posting worker requirements is a business-side action. A pure
   // 'worker' account can't post; 'business' and 'both' can; admins can
   // always do everything a normal ('both') account can, in addition to
   // moderation.
   function canPostAds(user) {
     if (!user) return false;
     if (user.role === 'admin') return true;
     return user.userType === 'business' || user.userType === 'both';
   }
   
   
   const EMPTY_FILTERS = {
     search: '', category: '', businessType: '', radius: 'all',
     minSalary: '', experience: '', education: '', skills: '', sortBy: '', urgentOnly: false
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
     if (filters.urgentOnly) list = list.filter((a) => a.urgent);
   
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
   
   // Worker-profile equivalent of filterAndSortAds — mirrors the same
   // radius/sort behaviour so "Workers near you" actually works once a
   // worker has saved a location on their profile.
   const WORKER_EMPTY_FILTERS = {
     search: '', category: '', availableOnly: false, radius: 'all', sortBy: ''
   };
   
   function filterAndSortWorkers(workers, filters, userCoords) {
     let list = withDistances(workers, userCoords);
   
     if (filters.radius && filters.radius !== 'all' && userCoords) {
       list = list.filter((w) => w.distanceKm == null || w.distanceKm <= Number(filters.radius));
     }
     if (filters.search) {
       const q = filters.search.toLowerCase();
       list = list.filter((w) => `${w.name} ${w.skillCategories} ${w.bio}`.toLowerCase().includes(q));
     }
     if (filters.category) {
       const q = filters.category.toLowerCase();
       list = list.filter((w) => (w.skillCategories || '').toLowerCase().includes(q));
     }
     if (filters.availableOnly) list = list.filter((w) => w.availableNow);
   
     const sortBy = filters.sortBy || (userCoords ? 'distance' : 'rating');
     list.sort((a, b) => {
       if (sortBy === 'distance') {
         if (a.distanceKm == null && b.distanceKm == null) return (Number(b.avgRating) || 0) - (Number(a.avgRating) || 0);
         if (a.distanceKm == null) return 1;
         if (b.distanceKm == null) return -1;
         return a.distanceKm - b.distanceKm;
       }
       if (sortBy === 'newest') return (b.ratingCount || 0) - (a.ratingCount || 0);
       return (Number(b.avgRating) || 0) - (Number(a.avgRating) || 0);
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
   // ANIMATION HELPERS
   // ------------------------------------------------------------
   function useIntersectionObserver(ref, options = { threshold: 0.1 }) {
     const [isVisible, setIsVisible] = useState(false);
   
     useEffect(() => {
       const observer = new IntersectionObserver(([entry]) => {
         if (entry.isIntersecting) {
           setIsVisible(true);
           observer.disconnect();
         }
       }, options);
   
       if (ref.current) {
         observer.observe(ref.current);
       }
   
       return () => observer.disconnect();
     }, [ref, options]);
   
     return isVisible;
   }
   
   function AnimatedSection({ children, className = '', delay = 0 }) {
     const ref = useRef(null);
     const isVisible = useIntersectionObserver(ref);
   
     return (
       <div
         ref={ref}
         className={`animated-section ${isVisible ? 'visible' : ''} ${className}`}
         style={{ transitionDelay: `${delay}ms` }}
       >
         {children}
       </div>
     );
   }
   
   function AnimatedCard({ children, className = '', delay = 0, onClick }) {
     const ref = useRef(null);
     const isVisible = useIntersectionObserver(ref);
   
     return (
       <div
         ref={ref}
         className={`animated-card ${isVisible ? 'visible' : ''} ${className}`}
         style={{ transitionDelay: `${delay}ms` }}
         onClick={onClick}
       >
         {children}
       </div>
     );
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
   
   function VerifiedBadge({ small }) {
     const t = useT();
     return (
       <span className="badge badge-admin" title={t('verified')} style={{ fontSize: small ? 11 : 12 }}>
         ✔ {t('verified')}
       </span>
     );
   }
   
   function SuspendedBadge({ small }) {
     return (
       <span className="badge badge-taken_down" title="Suspended by admin" style={{ fontSize: small ? 11 : 12 }}>
         ⛔ Suspended
       </span>
     );
   }
   
   function StarRating({ value, count, size }) {
     const v = Math.round(Number(value) || 0);
     const stars = [1, 2, 3, 4, 5].map((i) => (i <= v ? '★' : '☆'));
     return (
       <span className="mono" style={{ fontSize: size || 14, color: '#d4a017' }}>
         {stars.join('')}
         {typeof count === 'number' && <span style={{ color: 'var(--text-mute)', marginLeft: 4 }}>({count})</span>}
       </span>
     );
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
             'Turn on location to see results sorted by distance from you.'}
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
   // FILTER / MENU DRAWER — reusable hamburger slide-in panel.
   // Used by Browse Jobs ("☰ Filters"), Find Workers ("☰ Filters"),
   // and My Dashboard ("☰ Menu").
   // ------------------------------------------------------------
   function FilterDrawer({ open, onClose, title, children, side = 'left' }) {
     useEffect(() => {
       if (!open) return;
       const onKey = (e) => { if (e.key === 'Escape') onClose(); };
       window.addEventListener('keydown', onKey);
       const prevOverflow = document.body.style.overflow;
       document.body.style.overflow = 'hidden';
       return () => {
         window.removeEventListener('keydown', onKey);
         document.body.style.overflow = prevOverflow;
       };
     }, [open, onClose]);
   
     return (
       <>
         <div
           className={`filter-drawer-overlay ${open ? 'open' : ''}`}
           onClick={onClose}
           aria-hidden={!open}
         />
         <div
           className={`filter-drawer ${side === 'right' ? 'filter-drawer-right' : ''} ${open ? 'open' : ''}`}
           role="dialog"
           aria-modal="true"
           aria-label={title}
         >
           <div className="filter-drawer-head">
             <h3>{title}</h3>
             <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
           </div>
           <div className="filter-drawer-body">
             {children}
           </div>
         </div>
       </>
     );
   }
   
   // Circular avatar used for worker profile photos. Falls back to a
   // generic person icon when no photo has been uploaded.
   function PersonAvatar({ src, size = 64 }) {
     const baseStyle = {
       width: size, height: size, minWidth: size, borderRadius: '50%',
       overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
       background: '#e8e8e8', border: '2px solid #fff', boxShadow: '0 0 0 1px #ddd',
       flexShrink: 0
     };
     if (src) {
       return (
         <div style={baseStyle}>
           <img src={src} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
         </div>
       );
     }
     return (
       <div style={{ ...baseStyle, fontSize: size * 0.5, color: '#9a9a9a' }}>
         👤
       </div>
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
   
     const placeMarker = useCallback((map, la, ln) => {
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
     }, [markerDraggable]);
   
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
     }, [interactive, placeMarker, zoom]);
   
     useEffect(() => {
       if (!mapRef.current || lat == null || lng == null) return;
       mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), zoom));
       placeMarker(mapRef.current, lat, lng);
       setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
     }, [lat, lng, placeMarker, zoom]);
   
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
   
   // ------------------------------------------------------------
   // REVIEWS (shared between businesses and workers)
   // ------------------------------------------------------------
   function ReviewsList({ toUserId }) {
     const [reviews, setReviews] = useState(null);
     const [error, setError] = useState(null);
   
     useEffect(() => {
       if (!toUserId) return;
       setReviews(null); setError(null);
       apiCall('getUserReviews', { toUserId }).then((d) => setReviews(d.reviews)).catch((e) => setError(e.message));
     }, [toUserId]);
   
     if (!toUserId) return null;
     if (reviews === null && !error) return <p style={{ color: 'var(--text-mute)', fontSize: 14 }}>Loading reviews…</p>;
     if (error) return null;
     if (reviews.length === 0) return <p style={{ color: 'var(--text-mute)', fontSize: 14 }}>No reviews yet.</p>;
   
     return (
       <div className="review-list">
         {reviews.map((r) => (
           <div key={r.reviewId} className="review-item" style={{ borderBottom: '1px solid var(--border, #eee)', padding: '10px 0' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <strong>{r.fromUserName || 'Anonymous'}</strong>
               <StarRating value={r.rating} />
             </div>
             {r.comment && <p style={{ margin: '4px 0 0', fontSize: 14 }}>{r.comment}</p>}
             <span className="mono" style={{ fontSize: 11, color: 'var(--text-mute)' }}>{new Date(r.createdAt).toLocaleDateString()}</span>
           </div>
         ))}
       </div>
     );
   }
   
   function ReviewFormModal({ toUserId, toRole, adId, onClose, onSubmitted }) {
     const { user } = useAuth();
     const t = useT();
     const [rating, setRating] = useState(5);
     const [comment, setComment] = useState('');
     const [submitting, setSubmitting] = useState(false);
     const [error, setError] = useState(null);
   
     const submit = async () => {
       setSubmitting(true); setError(null);
       try {
         await apiCall('submitReview', {
           fromUserId: user.userId, fromUserName: user.name,
           toUserId, toRole, adId: adId || '', rating, comment
         });
         onSubmitted();
       } catch (err) { setError(err.message); } finally { setSubmitting(false); }
     };
   
     return (
       <div className="modal-overlay" onClick={onClose}>
         <div className="modal" onClick={(e) => e.stopPropagation()}>
           <div className="modal-head">
             <h2>{t('writeReview')}</h2>
             <button className="modal-close" onClick={onClose}>✕</button>
           </div>
           <div className="field">
             <label>Rating</label>
             <div style={{ display: 'flex', gap: 6, fontSize: 26, cursor: 'pointer' }}>
               {[1, 2, 3, 4, 5].map((i) => (
                 <span key={i} onClick={() => setRating(i)} style={{ color: i <= rating ? '#d4a017' : '#ccc' }}>★</span>
               ))}
             </div>
           </div>
           <div className="field">
             <label>Comment (optional)</label>
             <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share your experience..." />
           </div>
           {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
           <button className="btn btn-primary btn-block" disabled={submitting} onClick={submit}>
             {submitting ? 'Submitting...' : 'Submit review'}
           </button>
         </div>
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
     const [lang, setLang] = useState(() => {
       try { return localStorage.getItem('kb_lang') || 'en'; } catch (e) { return 'en'; }
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
     const updateUserLocal = (patch) => {
       setUser((u) => {
         const next = { ...u, ...patch };
         localStorage.setItem('kb_user', JSON.stringify(next));
         return next;
       });
     };
   
     const changeLang = (code) => {
       setLang(code);
       try { localStorage.setItem('kb_lang', code); } catch (e) {}
     };
   
     const authValue = { user, login, logout, updateUserLocal };
     const langValue = { lang, setLang: changeLang };
   
     return (
       <AuthContext.Provider value={authValue}>
         <LanguageContext.Provider value={langValue}>
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
         </LanguageContext.Provider>
       </AuthContext.Provider>
     );
   }
   
   // Shown when a logged-in worker-only account tries to reach a
   // business-only route (post/edit) directly.
   function PostNotAllowedPage({ navigate }) {
     return (
       <div className="container" style={{ maxWidth: 640, marginTop: 40 }}>
         <div className="card">
           <h2>Only business accounts can post requirements</h2>
           <p style={{ color: 'var(--text-mute)' }}>
             Your account is set up as a Job Seeker (Worker). To post worker requirements,
             switch your profile type to "Business / Employer" or "Both" from My Profile.
           </p>
           <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
             <button className="btn btn-primary" onClick={() => navigate('dashboard')}>Go to My Profile</button>
             <button className="btn btn-outline" onClick={() => navigate('browse')}>Browse jobs instead</button>
           </div>
         </div>
       </div>
     );
   }
   
   function MainRouter({ route, navigate }) {
     const { user } = useAuth();
     switch (route.page) {
       case 'home': return <HomePage navigate={navigate} />;
       case 'browse': return <AdvertisementsPage navigate={navigate} initialFilters={route.params.filters} />;
       case 'details': return <AdDetailsPage adId={route.params.adId} navigate={navigate} />;
       case 'post':
         if (!user) return <LoginPage navigate={navigate} initialMode="login" redirectTo="post" />;
         if (!canPostAds(user)) return <PostNotAllowedPage navigate={navigate} />;
         return <AdFormPage navigate={navigate} mode="create" />;
       case 'edit':
         if (!user) return <LoginPage navigate={navigate} initialMode="login" redirectTo="dashboard" />;
         if (!canPostAds(user)) return <PostNotAllowedPage navigate={navigate} />;
         return <AdFormPage navigate={navigate} mode="edit" adId={route.params.adId} />;
       case 'dashboard': return user ? <UserDashboardPage navigate={navigate} /> : <LoginPage navigate={navigate} initialMode="login" redirectTo="dashboard" />;
       case 'admin': return (user && user.role === 'admin') ? <AdminDashboardPage navigate={navigate} /> : <LoginPage navigate={navigate} initialMode="login" redirectTo="admin" />;
       case 'workers': return <WorkersBrowsePage navigate={navigate} />;
       case 'worker-details': return <WorkerProfileViewPage userId={route.params.userId} navigate={navigate} />;
       case 'login': return <LoginPage navigate={navigate} initialMode="login" redirectTo={route.params.redirectTo} />;
       case 'register': return <LoginPage navigate={navigate} initialMode="register" redirectTo={route.params.redirectTo} />;
       default: return <HomePage navigate={navigate} />;
     }
   }
   
   // ------------------------------------------------------------
   // FOOTER MODALS — Privacy / Terms / Cookies / Contact Developer
   // ------------------------------------------------------------
   const LEGAL_CONTENT = {
     privacy: {
       title: 'Privacy Policy',
       body: [
         'Rojgar AREA collects only the information you provide when you create an account, post a requirement, or build a worker profile — your name, contact details, business or worker information, and any location you choose to share.',
         'We use this information solely to connect job seekers with local businesses: to display your listing or profile to other users, to enable WhatsApp and phone contact, and to show relevant nearby results.',
         'We do not sell your personal data. Photos and documents you upload (workplace photos, profile photos, resumes) are stored with our image hosting provider and are only shown where you choose to display them.',
         'You can update or remove your profile information, pause or delete your advertisements, and control your location sharing at any time from your dashboard.'
       ]
     },
     terms: {
       title: 'Terms of Service',
       body: [
         'Rojgar AREA is a platform that lets local businesses post worker requirements and lets job seekers browse and apply to them directly. We are not a party to any employment agreement made between a business and a worker.',
         'Users agree to post accurate information. Misleading, fraudulent, or discriminatory listings may be reported, reviewed, and taken down by our admin team.',
         'Contact details shared on the platform (phone numbers, WhatsApp) are provided by users at their own discretion for the purpose of being contacted about job opportunities.',
         'We reserve the right to suspend or remove accounts and listings that violate these terms or misuse the platform.'
       ]
     },
     cookies: {
       title: 'Cookie Policy',
       body: [
         'Rojgar AREA uses local browser storage to keep you logged in and to remember your language preference between visits.',
         'We do not use third-party advertising cookies or trackers. Map tiles are loaded from OpenStreetMap and images from our hosting provider, which may set their own minimal technical cookies necessary to serve that content.',
         'You can clear your browser storage at any time to remove this information; you will simply need to log in again.'
       ]
     }
   };
   
   function LegalModal({ contentKey, onClose }) {
     const content = LEGAL_CONTENT[contentKey];
     if (!content) return null;
     return (
       <div className="modal-overlay" onClick={onClose}>
         <div className="modal" onClick={(e) => e.stopPropagation()}>
           <div className="modal-head">
             <h2>{content.title}</h2>
             <button className="modal-close" onClick={onClose}>✕</button>
           </div>
           {content.body.map((p, i) => (
             <p key={i} style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 10 }}>{p}</p>
           ))}
         </div>
       </div>
     );
   }
   
   function ContactDeveloperModal({ onClose }) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
          <div className="modal-head">
            <h2 style={{ color: '#1B1E19' }}>Contact Developer</h2>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
          <img
            src="https://i.postimg.cc/cH2C6rgk/611276591-17933684004156896-6444722502286434287-n-(1).jpg"
            alt="Shree Shyam IT Solutions"
            style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 14px', display: 'block' }}
          />
          <h3 style={{ marginBottom: 4, color: '#1B1E19' }}>Shree Shyam IT Solutions</h3>
          <p style={{ color: '#726C59', fontSize: 14, marginBottom: 18 }}>
            This platform was built and is maintained by Shree Shyam IT Solutions.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a
              href="mailto:itsolutionsshreeshyam@gmail.com"
              className="btn btn-outline btn-block"
              style={{ textDecoration: 'none', color: '#1B1E19' }}
            >
              ✉️ itsolutionsshreeshyam@gmail.com
            </a>
            <a
              href="https://shree-shyam-it-solutions.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-block"
              style={{ textDecoration: 'none' }}
            >
              🌐 Visit website
            </a>
          </div>
        </div>
      </div>
    );
  }
   
   function Footer({ navigate }) {
     const t = useT();
     const [modal, setModal] = useState(null); // 'privacy' | 'terms' | 'cookies' | 'contact' | null
     const handleNav = (path, params) => (e) => {
       e.preventDefault();
       navigate(path, params || {});
     };
   
     return (
<div className="footer">
  <div className="container">
    <div className="footer-grid">
      <div className="footer-col">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <img 
            src="https://i.postimg.cc/T32GbFLk/01ac7af7-359d-4a35-ba73-684213d999ef.png" 
            alt="Rojgar AREA Logo" 
            style={{ height: '40px', width: 'auto' }}
          />
          <h4 style={{ marginBottom: 0 }}>Rojgar AREA</h4>
        </div>
        <p>Connecting local businesses with workers across India. Find jobs near you or post requirements instantly.</p>
      </div>
      <div className="footer-col">
        <h4>Quick Links</h4>
        <button className="footer-link" onClick={handleNav('browse')}>{t('browseJobs')}</button>
        <button className="footer-link" onClick={handleNav('post')}>{t('postRequirement')}</button>
        <button className="footer-link" onClick={handleNav('workers')}>{t('findWorkers')}</button>
        <button className="footer-link" onClick={() => setModal('contact')}>About Us</button>
      </div>
      <div className="footer-col">
        <h4>Popular Searches</h4>
        <button className="footer-link" onClick={handleNav('browse')}>Jobs Near Me</button>
        <button className="footer-link" onClick={handleNav('browse')}>Hiring Today</button>
        <button className="footer-link" onClick={handleNav('browse')}>Part Time Jobs</button>
        <button className="footer-link" onClick={handleNav('browse')}>Fresher Jobs</button>
      </div>
      <div className="footer-col">
        <h4>Legal</h4>
        <button className="footer-link" onClick={() => setModal('privacy')}>Privacy Policy</button>
        <button className="footer-link" onClick={() => setModal('terms')}>Terms of Service</button>
        <button className="footer-link" onClick={() => setModal('cookies')}>Cookie Policy</button>
        <button className="footer-link" onClick={() => setModal('contact')}>Contact Developer</button>
      </div>
    </div>
    <div className="footer-bottom">
      <span>© 2026 Rojgar AREA — Made in India 🇮🇳</span>
    </div>
  </div>

  {(modal === 'privacy' || modal === 'terms' || modal === 'cookies') && (
    <LegalModal contentKey={modal} onClose={() => setModal(null)} />
  )}
  {modal === 'contact' && <ContactDeveloperModal onClose={() => setModal(null)} />}
</div>
     );
   }
   
   // ==============================================================
   // NAVBAR
   // ==============================================================
   function LanguageSwitcher() {
     const { lang, setLang } = useLanguage();
     return (
       <select
         className="lang-switcher"
         value={lang}
         onChange={(e) => setLang(e.target.value)}
         style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', fontSize: 13 }}
       >
         {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
       </select>
     );
   }
   
   function Navbar({ route, navigate }) {
    const { user, logout } = useAuth();
    const t = useT();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
  
    useEffect(() => {
      const handleScroll = () => {
        setScrolled(window.scrollY > 20);
      };
      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
    }, []);
  
    const showPostLink = !user || canPostAds(user);
    const closeMenu = () => setMobileMenuOpen(false);
  
    return (
      <div className={`navbar ${scrolled ? 'navbar-scrolled' : ''}`}>
        <div className="container navbar-inner">
          <div className="brand" onClick={() => { navigate('home'); closeMenu(); }}>
            <img
              src="https://i.postimg.cc/T32GbFLk/01ac7af7-359d-4a35-ba73-684213d999ef.png"
              alt="Rojgar AREA Logo"
              className="brand-logo"
              style={{ height: '40px', width: 'auto' }}
            />
            <div className="brand-text">Rojgar<span>AREA</span></div>
          </div>
  
          <button className="mobile-menu-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle menu">
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
  
          {/* Single wrapper — on desktop it's invisible to layout (display:contents),
              on mobile it becomes the one dropdown panel, so nav-links always
              render above nav-user in the DOM and on screen. */}
          <div className={`nav-menu-wrapper ${mobileMenuOpen ? 'open' : ''}`}>
            <div className="nav-links">
              <button className={`nav-link ${route.page === 'home' ? 'active' : ''}`} onClick={() => { navigate('home'); closeMenu(); }}>{t('home')}</button>
              <button className={`nav-link ${route.page === 'browse' ? 'active' : ''}`} onClick={() => { navigate('browse'); closeMenu(); }}>{t('browseJobs')}</button>
              <button className={`nav-link ${route.page === 'workers' ? 'active' : ''}`} onClick={() => { navigate('workers'); closeMenu(); }}>{t('findWorkers')}</button>
              {showPostLink && (
                <button className={`nav-link ${route.page === 'post' ? 'active' : ''}`} onClick={() => { navigate('post'); closeMenu(); }}>{t('postRequirement')}</button>
              )}
              {user && <button className={`nav-link ${route.page === 'dashboard' ? 'active' : ''}`} onClick={() => { navigate('dashboard'); closeMenu(); }}>{t('myDashboard')}</button>}
              {user && user.role === 'admin' && <button className={`nav-link ${route.page === 'admin' ? 'active' : ''}`} onClick={() => { navigate('admin'); closeMenu(); }}>{t('admin')}</button>}
            </div>
  
            <div className="nav-user">
              <LanguageSwitcher />
              {user ? (
                <>
                  <div className="nav-avatar" title={user.name}>{user.name.charAt(0).toUpperCase()}</div>
                  <button className="btn-ghost-light" onClick={logout}>{t('logout')}</button>
                </>
              ) : (
                <>
                  <button className="btn-ghost-light" onClick={() => { navigate('login'); closeMenu(); }}>{t('login')}</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { navigate('register'); closeMenu(); }}>{t('signup')}</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
   
   // ==============================================================
   // HOME PAGE — Enhanced with animations and images
   // ==============================================================
   function HomePage({ navigate }) {
     const geo = useGeo();
     const t = useT();
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
   
     const urgentAds = useMemo(() => {
       if (!allAds) return [];
       return filterAndSortAds(allAds, { ...EMPTY_FILTERS, urgentOnly: true }, geo.coords).slice(0, 8);
     }, [allAds, geo.coords]);
   
     const activeCount = useMemo(
       () => (allAds || []).filter((a) => a.status === 'active').length,
       [allAds]
     );
   
     const jobCategories = useMemo(() => {
       const counts = {};
       (allAds || []).forEach((ad) => {
         if (ad.status !== 'active') return;
         const cat = categoryOf(ad);
         if (!cat) return;
         counts[cat] = (counts[cat] || 0) + 1;
       });
       return Object.entries(counts)
         .sort((a, b) => b[1] - a[1])
         .slice(0, 8)
         .map(([name, count]) => ({ 
           icon: CATEGORY_ICONS[name] || '📋', 
           name, 
           count,
           image: CATEGORY_IMAGES[name] || null
         }));
     }, [allAds]);
   
     const steps = [
       { number: '01', title: 'Search Jobs', description: 'Find thousands of worker requirements from local businesses near you.', icon: '🔍' },
       { number: '02', title: 'Apply Instantly', description: 'Apply to jobs with one click and get contacted by employers.', icon: '📝' },
       { number: '03', title: 'Get Hired', description: 'Connect directly with businesses and start working.', icon: '🎉' },
     ];
   
     // Hero images for the background slideshow
     const heroImages = [
       'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=1200&h=600&fit=crop',
       'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=600&fit=crop',
       'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1200&h=600&fit=crop',
     ];
   
     const [heroImageIndex, setHeroImageIndex] = useState(0);
   
     useEffect(() => {
      const interval = setInterval(() => {
        setHeroImageIndex((prev) => (prev + 1) % heroImages.length);
      }, 6000);
      return () => clearInterval(interval);
    }, [heroImages.length]);
   
     return (
       <div>
         {/* HERO SECTION with slideshow */}
         <div className="hero">
           <div className="hero-slideshow">
             {heroImages.map((img, i) => (
               <div 
                 key={i} 
                 className={`hero-slide ${i === heroImageIndex ? 'active' : ''}`}
                 style={{ backgroundImage: `url(${img})` }}
               />
             ))}
             <div className="hero-overlay"></div>
           </div>
           <div className="hero-particles"></div>
           <div className="container">
             <div className="hero-badge animate-float">🇮🇳 India's First Local Job Platform</div>
             <h1 className="animate-slide-up">{t('heroTitle')}</h1>
             <p className="animate-slide-up-delay">{t('heroSubtitle')}</p>
             
             <form className="hero-search animate-slide-up-delay-2" onSubmit={runSearch}>
               <div className="hero-search-group">
                 <div className="hero-search-field">
                   <span className="hero-search-icon">🔍</span>
                   <input
                     type="text"
                     placeholder={t('searchPlaceholder')}
                     value={search}
                     onChange={(e) => setSearch(e.target.value)}
                   />
                 </div>
                 <div className="hero-search-field">
                   <span className="hero-search-icon">📍</span>
                   <input
                     type="text"
                     placeholder={t('locationPlaceholder')}
                     value={locationSearch}
                     onChange={(e) => setLocationSearch(e.target.value)}
                   />
                 </div>
                 <button type="submit" className="btn btn-primary btn-lg">{t('searchJobs')}</button>
               </div>
             </form>
   
             <div className="hero-actions animate-slide-up-delay-3">
               <button className="btn btn-outline-light" onClick={runNearbySearch}>
                 {t('findJobsNearMe')}
               </button>
               <span className="hero-stats">
                 <strong className="counter-animate">{allAds ? activeCount : '—'}</strong> active requirements · <strong>{allAds?.length || 0}</strong> total listings
               </span>
             </div>
           </div>
         </div>
   
         {/* URGENT / HIRING TODAY SECTION */}
         {urgentAds.length > 0 && (
           <div className="container" style={{ marginTop: 30 }}>
             <div className="section-head">
               <h2>{t('urgentHiring')}<span className="count-pill">{urgentAds.length}</span></h2>
               <button className="btn btn-outline btn-sm" onClick={() => navigate('browse', { filters: { ...EMPTY_FILTERS, urgentOnly: true } })}>{t('viewAll')}</button>
             </div>
             <div className="grid">
               {urgentAds.map((ad, i) => (
                 <AnimatedCard key={ad.adId} delay={i * 50}>
                   <AdCard ad={ad} onClick={() => navigate('details', { adId: ad.adId })} />
                 </AnimatedCard>
               ))}
             </div>
           </div>
         )}
   
         {/* JOB CATEGORIES SECTION with images */}
         <div className="categories-section">
           <div className="container">
             <AnimatedSection className="section-head text-center">
               <h2>{t('popularCategories')}</h2>

               <p>Find jobs in your preferred category from verified local businesses</p>
             </AnimatedSection>
             {allAds === null && !error && (
               <p style={{ textAlign: 'center', color: 'var(--text-mute)' }}>Loading categories…</p>
             )}
             {error && <p style={{ textAlign: 'center', color: 'var(--danger)' }}>{error}</p>}
             {allAds && jobCategories.length === 0 && (
               <p style={{ textAlign: 'center', color: 'var(--text-mute)' }}>
                 No active categories yet — be the first to post a requirement.
               </p>
             )}
             {jobCategories.length > 0 && (
               <div className="categories-grid">
                 {jobCategories.map((cat, i) => (
                   <AnimatedCard key={i} delay={i * 50} className="category-card" onClick={() => navigate('browse', { filters: { ...EMPTY_FILTERS, category: cat.name } })}>
                     {cat.image && (
                       <div className="category-card-image">
                         <img src={cat.image} alt={cat.name} loading="lazy" />
                         <div className="category-card-overlay"></div>
                       </div>
                     )}
                     <div className="category-card-content">
                       <div className="category-icon">{cat.icon}</div>
                       <h4>{cat.name}</h4>
                       <span className="category-count">{cat.count} {cat.count === 1 ? 'job' : 'jobs'}</span>
                     </div>
                   </AnimatedCard>
                 ))}
               </div>
             )}
           </div>
         </div>
   
         {/* JOB TYPE HIGHLIGHTS */}
         <div className="knowledge-packs">
           <div className="container">
             <AnimatedSection className="packs-header">
               <h2>Find Your Perfect Job</h2>
               <p>Browse through curated job listings from verified businesses</p>
             </AnimatedSection>
   
             <div className="packs-grid">
               <AnimatedCard delay={0} className="pack-card featured">
                 <div className="pack-card-body pack-card-body-icon">
                   <div className="pack-card-icon">💼</div>
                   <h3>Full Time Jobs</h3>
                   <p>Stable employment with fixed working hours and monthly salary.</p>
                   <button className="btn btn-primary btn-sm" onClick={() => navigate('browse')}>
                     View Jobs →
                   </button>
                 </div>
               </AnimatedCard>
   
               <AnimatedCard delay={100} className="pack-card">
                 <div className="pack-card-body pack-card-body-icon">
                   <div className="pack-card-icon">⏱️</div>
                   <h3>Part Time Jobs</h3>
                   <p>Flexible work opportunities for students and homemakers.</p>
                   <button className="btn btn-outline btn-sm" onClick={() => navigate('browse',)}>
                     View Jobs →
                   </button>
                 </div>
               </AnimatedCard>
   
               <AnimatedCard delay={200} className="pack-card">
                 <div className="pack-card-body pack-card-body-icon">
                   <div className="pack-card-icon">🧑‍💻</div>
                   <h3>Freelance & Contract</h3>
                   <p>Project-based work opportunities with flexible schedules.</p>
                   <button className="btn btn-outline btn-sm" onClick={() => navigate('browse',)}>
                     View Jobs →
                   </button>
                 </div>
               </AnimatedCard>
             </div>
           </div>
         </div>

                  {/* LATEST JOBS SECTION */}
                  <div className="container">
           <LocationBanner />
   
           <div className="section-head">
             <h2>
               {geo.status === 'granted' ? `Jobs within ${HOME_DEFAULT_RADIUS} km of you` : 'Recently posted requirements'}
               {nearby && <span className="count-pill">{nearby.length}</span>}
             </h2>
             <button className="btn btn-outline btn-sm" onClick={() => navigate('browse', geo.status === 'granted' ? { filters: { ...EMPTY_FILTERS, radius: HOME_DEFAULT_RADIUS } } : undefined)}>
               {t('viewAll')}
             </button>
           </div>
   
           {allAds === null && !error && <Spinner label="Loading advertisements..." />}
           {error && <ErrorState message={error} onRetry={load} />}
           {nearby && nearby.length === 0 && (
             <EmptyState icon="🗂️" title="No advertisements found nearby" message="Try widening your search radius from the Browse Jobs page." />
           )}
           {nearby && nearby.length > 0 && (
             <div className="grid">
               {nearby.map((ad, i) => (
                 <AnimatedCard key={ad.adId} delay={i * 50}>
                   <AdCard ad={ad} onClick={() => navigate('details', { adId: ad.adId })} />
                 </AnimatedCard>
               ))}
             </div>
           )}
   
         </div>
   
         {/* HOW IT WORKS */}
         <div className="how-it-works">
           <div className="container">
             <AnimatedSection className="section-head text-center">
               <h2>{t('howItWorks')}</h2>
               <p>Three simple steps to find your next job opportunity</p>
             </AnimatedSection>
             <div className="steps-grid">
               {steps.map((step, i) => (
                 <AnimatedCard key={i} delay={i * 100} className="step-card">
                   <div className="step-number">{step.number}</div>
                   <div className="step-icon">{step.icon}</div>
                   <h3>{step.title}</h3>
                   <p>{step.description}</p>
                 </AnimatedCard>
               ))}
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
           {isNew && !ad.urgent && <div className="ad-card-new">New</div>}
           {ad.urgent && <div className="ad-card-new" style={{ background: 'var(--danger, #d9363e)' }}>🔥 Urgent</div>}
         </div>
         <div className="ad-card-body">
           <div className="ad-card-title">
             {ad.jobTitle}
             {ad.businessVerified && <VerifiedBadge small />}
           </div>
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
   // FILTER PANEL — content rendered inside the "Filters" drawer
   // on the Browse Jobs page.
   // ==============================================================
   function FilterPanel({ filters, setFilters, categoryOptions, geoStatus, onRequestLocation, resultCount }) {
     const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
     const reset = () => setFilters({ ...EMPTY_FILTERS });
   
     return (
       <div className="filter-sidebar">
         <div className="filter-sidebar-head">
           <span style={{ fontSize: 12, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 700 }}>Refine your search</span>
           <button className="link-btn" onClick={reset}>Reset all</button>
         </div>
   
         <div className="field">
           <label>Search</label>
           <input value={filters.search} onChange={(e) => set('search', e.target.value)} placeholder="Job title, business, skill..." />
         </div>
   
         <div className="field">
           <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <input type="checkbox" checked={!!filters.urgentOnly} onChange={(e) => set('urgentOnly', e.target.checked)} />
             🔥 Hiring today only
           </label>
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
     const [filtersOpen, setFiltersOpen] = useState(false);
   
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
           <button className="btn btn-outline filters-toggle-btn" onClick={() => setFiltersOpen(true)}>
             ☰ Filters
           </button>
         </div>
   
         <LocationBanner compact />
   
         <div className="browse-results-full">
           {allAds === null && !error && <Spinner label="Loading advertisements..." />}
           {error && <ErrorState message={error} onRetry={load} />}
           {results && results.length === 0 && (
             <EmptyState icon="🗂️" title="No advertisements found" message="Try clearing some filters or widening your search radius." />
           )}
           {results && results.length > 0 && (
             <div className="grid">
               {results.map((ad, i) => (
                 <AnimatedCard key={ad.adId} delay={i % 10 * 50}>
                   <AdCard ad={ad} onClick={() => navigate('details', { adId: ad.adId })} />
                 </AnimatedCard>
               ))}
             </div>
           )}
         </div>
   
         <FilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
           <FilterPanel
             filters={filters} setFilters={setFilters}
             categoryOptions={categoryOptions}
             geoStatus={geo.status} onRequestLocation={geo.request}
             resultCount={results ? results.length : undefined}
           />
         </FilterDrawer>
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
     const t = useT();
     const [ad, setAd] = useState(null);
     const [error, setError] = useState(null);
     const [activeImg, setActiveImg] = useState(0);
     const [lightboxIndex, setLightboxIndex] = useState(null);
     const [saved, setSaved] = useState(false);
     const [reportOpen, setReportOpen] = useState(false);
     const [reviewOpen, setReviewOpen] = useState(false);
     const [reviewsKey, setReviewsKey] = useState(0);
     const [, setApplied] = useState(false);
     const [directionsLoading, setDirectionsLoading] = useState(false);
   
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
   
     const openDirections = () => {
       if (!ad.locationLat || !ad.locationLng) {
         toast('Workplace location is not available.', 'error');
         return;
       }
       setDirectionsLoading(true);
       openDirectionsToCoords(ad.locationLat, ad.locationLng, () => setDirectionsLoading(false));
     };
   
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
     const whatsappLink = buildWhatsAppLink(ad.contactPhone, `Hi, I'm interested in the "${ad.jobTitle}" position at ${ad.businessName} that I saw on Rojgar AREA.`);
   
     return (
       <div className="container">
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
               {ad.urgent && <div className="ad-card-new" style={{ background: 'var(--danger, #d9363e)', position: 'absolute', top: 10, left: 10 }}>🔥 Hiring Today</div>}
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
                 <button 
                   className="btn btn-primary btn-block" 
                   onClick={openDirections}
                   disabled={directionsLoading}
                   style={{ marginTop: 12 }}
                 >
                   {directionsLoading ? 'Getting your location...' : t('getDirections')}
                 </button>
                 {geo.status === 'denied' && (
                   <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>
                     Location permission denied. You'll need to enter your location manually in Google Maps.
                   </p>
                 )}
               </div>
             )}
   
             <div className="desc-block">
               <h3>{t('reviews')} {ad.businessRatingCount > 0 && <StarRating value={ad.businessRating} count={ad.businessRatingCount} />}</h3>
               <ReviewsList key={reviewsKey} toUserId={ad.postedBy} />
               {user && !isOwner && (
                 <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => setReviewOpen(true)}>{t('writeReview')}</button>
               )}
             </div>
           </div>
   
           <div className="details-panel">
             <StatusBadge status={ad.status} />
             {ad.businessVerified && <span style={{ marginLeft: 8 }}><VerifiedBadge /></span>}
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
               <div className="spec-row"><span className="label">Contact</span><span className="val">{ad.contactPhone ? <a href={`tel:${ad.contactPhone}`}>{ad.contactPhone}</a> : 'See description'}</span></div>
               <div className="spec-row"><span className="label">Posted</span><span className="val">{new Date(ad.postedAt).toLocaleDateString()}</span></div>
             </div>
   
             {ad.status === 'active' && !isOwner && (whatsappLink || ad.contactPhone) && (
               <div className="action-row" style={{ display: 'flex', gap: 10 }}>
                 {whatsappLink && (
                   <a
                     href={whatsappLink}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="btn btn-block"
                     style={{ background: '#25D366', color: '#fff', textAlign: 'center', display: 'block', textDecoration: 'none', padding: '10px 14px', borderRadius: 8 }}
                   >
                     {t('applyWhatsApp')}
                   </a>
                 )}
                 {ad.contactPhone && (
                   <a
                     href={`tel:${ad.contactPhone}`}
                     className="btn btn-outline btn-block"
                     style={{ textAlign: 'center', display: 'block', textDecoration: 'none', padding: '10px 14px' }}
                   >
                     📞 {ad.contactPhone}
                   </a>
                 )}
               </div>
             )}
   
             {/* Save & Report are available to every role (worker, business, admin) — not gated by userType. */}
             {ad.status === 'active' && !isOwner && (
               <div className="action-row">
                 <button className={`btn ${saved ? 'btn-success' : 'btn-outline'} btn-block`} onClick={toggleSave}>
                   {saved ? t('saved') : t('save')}
                 </button>
               </div>
             )}
             {ad.status === 'active' && !isOwner && (
               <button className="btn btn-outline btn-block" style={{ marginTop: 10, color: 'var(--danger)' }} onClick={() => user ? setReportOpen(true) : navigate('login', { redirectTo: 'home' })}>
                 {t('report')}
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
   
         {reviewOpen && (
           <ReviewFormModal
             toUserId={ad.postedBy}
             toRole="business"
             adId={ad.adId}
             onClose={() => setReviewOpen(false)}
             onSubmitted={() => { setReviewOpen(false); setReviewsKey((k) => k + 1); toast('Thanks for your review!', 'success'); }}
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
     description: '', contactPhone: '', locationLat: null, locationLng: null, locationAddress: '', urgent: false
   };
   
   function SalaryBenchmarkHint({ category }) {
     const t = useT();
     const [benchmark, setBenchmark] = useState(null);
   
     useEffect(() => {
       if (!category || category === 'Other') { setBenchmark(null); return; }
       let cancelled = false;
       apiCall('getSalaryBenchmark', { category }).then((d) => {
         if (!cancelled) setBenchmark(d);
       }).catch(() => {});
       return () => { cancelled = true; };
     }, [category]);
   
     if (!benchmark || !benchmark.avgSalary) return null;
     return (
       <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 4 }}>
         💡 {t('salaryBenchmark')} "{category}": ₹{benchmark.avgSalary}/month (based on {benchmark.sampleSize} listings, range ₹{benchmark.minSalary}–₹{benchmark.maxSalary})
       </p>
     );
   }
   
   function AdFormPage({ navigate, mode, adId }) {
    const { user } = useAuth();
    const toast = useToast();
    const t = useT();
    const isEdit = mode === 'edit';
    const [form, setForm] = useState(BLANK_FORM);
    const [images, setImages] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(isEdit);
    const [notFoundOrForbidden, setNotFoundOrForbidden] = useState(false);
  
    // Move the permission check AFTER all hooks
    // All hooks must be called unconditionally at the top level
  
    useEffect(() => {
      // Only fetch data if editing and user has permission
      if (!isEdit || !canPostAds(user)) return;
      
      apiCall('getAdById', { adId }).then((data) => {
        const ad = data.ad;
        if (ad.postedBy !== user.userId) { 
          setNotFoundOrForbidden(true); 
          setLoading(false); 
          return;
        }
        setForm({
          businessName: ad.businessName || '', businessType: ad.businessType || BUSINESS_TYPES[0],
          jobTitle: ad.jobTitle || '', workerCategory: ad.workerCategory || WORKER_CATEGORIES[0],
          customCategory: ad.customCategory || '', numWorkers: ad.numWorkers || 1, salary: ad.salary || '',
          education: ad.education || '', experience: ad.experience || '', skills: ad.skills || '',
          workingHours: ad.workingHours || '', description: ad.description || '', contactPhone: ad.contactPhone || '',
          locationLat: ad.locationLat, locationLng: ad.locationLng, locationAddress: ad.locationAddress || '',
          urgent: !!ad.urgent
        });
        setImages(ad.images || []);
        setLoading(false);
      }).catch(() => { 
        setNotFoundOrForbidden(true); 
        setLoading(false); 
      });
    }, [isEdit, adId, user.userId, user]); // Add user to dependencies
  
    // Defense in depth: check permission after all hooks
    if (!canPostAds(user)) {
      return <PostNotAllowedPage navigate={navigate} />;
    }
  
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  
    const submit = async (e) => {
      e.preventDefault();
      if (!form.businessName || !form.jobTitle) { 
        setError('Business name and job title are required.'); 
        return; 
      }
      if (form.workerCategory === 'Other' && !form.customCategory.trim()) {
        setError('Please describe the worker category.'); 
        return;
      }
      setSubmitting(true); 
      setError(null);
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
      } catch (err) { 
        setError(err.message); 
      } finally { 
        setSubmitting(false); 
      }
    };
  
    if (loading) return <div className="container"><Spinner label="Loading advertisement..." /></div>;
    if (notFoundOrForbidden) return <div className="container"><ErrorState message="You can't edit this advertisement." onRetry={() => navigate('dashboard')} /></div>;
  
    return (
      <div className="container form-page">
        <h1>{isEdit ? 'Edit your requirement' : t('postAJob')}</h1>
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
            <div className="field full"><label>Contact phone (used for WhatsApp "Apply Now")</label>
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
            <div className="field">
              <label>Salary (monthly, ₹)</label>
              <input value={form.salary} onChange={(e) => set('salary', e.target.value)} placeholder="e.g. 12000-15000" />
              <SalaryBenchmarkHint category={categoryOf({ workerCategory: form.workerCategory, customCategory: form.customCategory })} />
            </div>
            <div className="field"><label>Education requirement</label>
              <input value={form.education} onChange={(e) => set('education', e.target.value)} placeholder="e.g. 10th pass / none" /></div>
            <div className="field"><label>Experience required</label>
              <input value={form.experience} onChange={(e) => set('experience', e.target.value)} placeholder="e.g. 1+ years / freshers ok" /></div>
            <div className="field"><label>Working hours</label>
              <input value={form.workingHours} onChange={(e) => set('workingHours', e.target.value)} placeholder="e.g. 9 AM - 6 PM, 6 days/week" /></div>
            <div className="field"><label>Skills required</label>
              <input value={form.skills} onChange={(e) => set('skills', e.target.value)} placeholder="e.g. stitching, ironing" /></div>
            <div className="field full">
              <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={!!form.urgent} onChange={(e) => set('urgent', e.target.checked)} />
                🔥 Mark as urgent — hiring today / immediate joining
              </label>
            </div>
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
   
   // Single-image uploader used for a worker's circular profile photo.
   function ProfilePhotoUploader({ photo, onChange }) {
     const inputRef = useRef(null);
     const [uploading, setUploading] = useState(false);
   
     const handleFile = async (file) => {
       if (!file || !file.type.startsWith('image/')) return;
       setUploading(true);
       try {
         const url = await uploadToCloudinary(file);
         onChange(url);
       } catch (err) {
         alert('Photo upload failed: ' + err.message);
       } finally {
         setUploading(false);
       }
     };
   
     return (
       <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
         <div style={{ position: 'relative' }}>
           <PersonAvatar src={photo} size={84} />
           {uploading && (
             <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <div className="spinner" style={{ width: 20, height: 20, marginBottom: 0 }}></div>
             </div>
           )}
         </div>
         <div>
           <button type="button" className="btn btn-outline btn-sm" onClick={() => inputRef.current.click()}>
             {photo ? 'Change photo' : 'Upload photo'}
           </button>
           {photo && (
             <button type="button" className="link-btn" style={{ marginLeft: 10 }} onClick={() => onChange('')}>Remove</button>
           )}
           <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e.target.files[0])} />
           <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 4 }}>Optional — shown as your profile picture. If skipped, a generic icon is shown instead.</div>
         </div>
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
             {coords.lat ? `Lat ${coords.lat.toFixed(5)}, Lng ${coords.lng.toFixed(5)}` : 'Click on the map or drag the pin to set the location'}
           </span>
         </div>
         <div className="map-wrap">
           <MapView lat={coords.lat} lng={coords.lng} interactive markerDraggable onPick={handlePick} height="300px" />
         </div>
         <div className="field" style={{ marginTop: 12 }}>
           <label>Address / nearby landmark</label>
           <input
             value={localAddress}
             onChange={(e) => { setLocalAddress(e.target.value); onChange(coords.lat, coords.lng, e.target.value); }}
             placeholder="e.g. Near Bus Stand, Industrial Area Phase 2"
           />
         </div>
         {!coords.lat && (
           <p style={{ fontSize: 12, color: 'var(--danger, #d9363e)', marginTop: 8 }}>
             ⚠️ Typing an address alone won't set your location on the map — click the map, drag the pin, or use
             "Use current location" so distance search actually finds you.
           </p>
         )}
       </div>
     );
   }
   
   // ==============================================================
   // WORKER PROFILES — browse, view, and edit
   // ==============================================================
   function WorkerCard({ worker, onClick }) {
     const t = useT();
     const whatsappLink = buildWhatsAppLink(worker.phone, `Hi ${worker.name}, I saw your profile on Rojgar AREA and I'd like to talk about a job opportunity.`);
     return (
       <div className="ad-card" onClick={onClick}>
         <div className="ad-card-body">
           <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
             <PersonAvatar src={worker.profilePhoto} size={48} />
             <div>
               <div className="ad-card-title" style={{ marginBottom: 0 }}>
                 {worker.name}
                 {worker.verified && <VerifiedBadge small />}
               </div>
               <div className="ad-card-biz">{worker.skillCategories || 'General worker'}</div>
             </div>
           </div>
           <div className="ad-card-meta">
             <span>🧰 {worker.experienceYears ? `${worker.experienceYears} experience` : 'Experience not specified'}</span>
             {worker.availableNow && <span style={{ color: 'var(--success, #1a9d5c)' }}>🟢 {t('availableNow')}</span>}
           </div>
           {worker.phone && (
             <div className="ad-card-meta" style={{ marginTop: -2 }}>
               <span>📞 {worker.phone}</span>
             </div>
           )}
           {worker.locationAddress && (
             <div className="ad-card-meta" style={{ marginTop: -2 }}>
               <span>📍 {worker.locationAddress}</span>
             </div>
           )}
           {worker.distanceKm != null && <div className="ad-card-distance"><DistanceChip km={worker.distanceKm} /></div>}
           {worker.ratingCount > 0 && <StarRating value={worker.avgRating} count={worker.ratingCount} />}
           {worker.bio && <p style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 6 }}>{worker.bio}</p>}
           {whatsappLink && (
             <a
               href={whatsappLink}
               target="_blank"
               rel="noopener noreferrer"
               onClick={(e) => e.stopPropagation()}
               className="btn btn-sm"
               style={{ background: '#25D366', color: '#fff', textDecoration: 'none', display: 'inline-block', marginTop: 8, padding: '6px 12px', borderRadius: 6 }}
             >
               {t('applyWhatsApp')}
             </a>
           )}
         </div>
       </div>
     );
   }
   
   // Content rendered inside the "Filters" drawer on the Find Workers page.
   function WorkerFilterPanel({ filters, setFilters, geoStatus, onRequestLocation, resultCount, totalCount, withLocationCount }) {
     const t = useT();
     const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
     const resetFilters = () => setFilters({ ...WORKER_EMPTY_FILTERS });
   
     return (
       <div className="filter-sidebar">
         <div className="filter-sidebar-head">
           <span style={{ fontSize: 12, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 700 }}>Refine your search</span>
           <button className="link-btn" onClick={resetFilters}>Reset all</button>
         </div>
   
         <div className="field">
           <label>Search</label>
           <input value={filters.search} onChange={(e) => set('search', e.target.value)} placeholder="Name, skill, bio..." />
         </div>
         <div className="field">
           <label>Category</label>
           <select value={filters.category} onChange={(e) => set('category', e.target.value)}>
             <option value="">All categories</option>
             {WORKER_CATEGORIES.filter((c) => c !== 'Other').map((c) => <option key={c} value={c}>{c}</option>)}
           </select>
         </div>
         <div className="field">
           <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <input type="checkbox" checked={filters.availableOnly} onChange={(e) => set('availableOnly', e.target.checked)} />
             {t('availableNow')} only
           </label>
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
           <label>Sort by</label>
           <select value={filters.sortBy} onChange={(e) => set('sortBy', e.target.value)}>
             <option value="">{geoStatus === 'granted' ? 'Nearest first' : 'Top rated first'}</option>
             {geoStatus === 'granted' && <option value="distance">Nearest first</option>}
             <option value="rating">Top rated first</option>
           </select>
         </div>
   
         {typeof resultCount === 'number' && (
           <div className="filter-result-count">
             {resultCount} matching {resultCount === 1 ? 'worker' : 'workers'}
             {withLocationCount != null && totalCount != null && withLocationCount < totalCount && (
               <div style={{ fontWeight: 400, color: 'var(--text-mute)', marginTop: 4, fontSize: 12 }}>
                 {totalCount - withLocationCount} of {totalCount} worker profiles haven't pinned a location on the map yet, so they won't show a distance.
               </div>
             )}
           </div>
         )}
       </div>
     );
   }
   
   function WorkersBrowsePage({ navigate }) {
     const t = useT();
     const geo = useGeo();
     const [rawWorkers, setRawWorkers] = useState(null);
     const [error, setError] = useState(null);
     const [filters, setFilters] = useState({ ...WORKER_EMPTY_FILTERS });
     const [filtersOpen, setFiltersOpen] = useState(false);
   
     const load = useCallback(() => {
       setRawWorkers(null); setError(null);
       apiCall('searchWorkers', { search: filters.search, category: filters.category, availableOnly: filters.availableOnly })
         .then((d) => setRawWorkers(d.workers))
         .catch((e) => setError(e.message));
     }, [filters.search, filters.category, filters.availableOnly]);
   
     useEffect(() => {
       const timer = setTimeout(load, 250);
       return () => clearTimeout(timer);
     }, [load]);
   
     // Radius/sort/distance are computed client-side (mirrors filterAndSortAds)
     // so this actually reflects the worker's saved profile location.
     const workers = useMemo(() => {
       if (!rawWorkers) return null;
       return filterAndSortWorkers(rawWorkers, filters, geo.coords);
     }, [rawWorkers, filters, geo.coords]);
   
     const withLocationCount = useMemo(
       () => (rawWorkers || []).filter((w) => w.locationLat != null && w.locationLng != null).length,
       [rawWorkers]
     );
   
     return (
       <div className="container">
         <div className="section-head" style={{ marginTop: 30 }}>
           <h2>{t('workersNearYou')} {workers && <span className="count-pill">{workers.length}</span>}</h2>
           <button className="btn btn-outline filters-toggle-btn" onClick={() => setFiltersOpen(true)}>
             ☰ Filters
           </button>
         </div>
   
         <LocationBanner compact />
   
         <div className="browse-results-full">
           {rawWorkers === null && !error && <Spinner label="Loading workers..." />}
           {error && <ErrorState message={error} onRetry={load} />}
           {workers && workers.length === 0 && (
             <EmptyState icon="🧰" title="No worker profiles found" message="Workers who complete their profile will show up here." />
           )}
           {workers && workers.length > 0 && (
             <div className="grid">
               {workers.map((w, i) => (
                 <AnimatedCard key={w.userId} delay={i % 10 * 50}>
                   <WorkerCard worker={w} onClick={() => navigate('worker-details', { userId: w.userId })} />
                 </AnimatedCard>
               ))}
             </div>
           )}
         </div>
   
         <FilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
           <WorkerFilterPanel
             filters={filters} setFilters={setFilters}
             geoStatus={geo.status} onRequestLocation={geo.request}
             resultCount={workers ? workers.length : undefined}
             totalCount={rawWorkers ? rawWorkers.length : undefined}
             withLocationCount={rawWorkers ? withLocationCount : undefined}
           />
         </FilterDrawer>
       </div>
     );
   }
   
   function WorkerProfileViewPage({ userId, navigate }) {
     const { user } = useAuth();
     const geo = useGeo();
     const toast = useToast();
     const t = useT();
     const [worker, setWorker] = useState(null);
     const [error, setError] = useState(null);
     const [reviewOpen, setReviewOpen] = useState(false);
     const [reviewsKey, setReviewsKey] = useState(0);
     const [lightboxIndex, setLightboxIndex] = useState(null);
     const [directionsLoading, setDirectionsLoading] = useState(false);
   
     const load = useCallback(() => {
       setWorker(null); setError(null);
       apiCall('getWorkerProfile', { userId }).then((d) => setWorker(d.user)).catch((e) => setError(e.message));
     }, [userId]);
     useEffect(() => { load(); }, [load]);
   
     if (error) return <div className="container"><ErrorState message={error} onRetry={load} /></div>;
     if (!worker) return <div className="container"><Spinner label="Loading profile..." /></div>;
   
     const isSelf = user && user.userId === worker.userId;
     const whatsappLink = buildWhatsAppLink(worker.phone, `Hi ${worker.name}, I saw your profile on Rojgar AREA and I'd like to talk about a job opportunity.`);
     const distanceKm = (geo.coords && worker.locationLat != null && worker.locationLng != null)
       ? haversineDistanceKm(geo.coords.lat, geo.coords.lng, worker.locationLat, worker.locationLng)
       : null;
     const resumeImages = worker.resumeImages || [];
   
     const openDirections = () => {
       if (worker.locationLat == null || worker.locationLng == null) {
         toast('This worker has not pinned a location yet.', 'error');
         return;
       }
       setDirectionsLoading(true);
       openDirectionsToCoords(worker.locationLat, worker.locationLng, () => setDirectionsLoading(false));
     };
   
     return (
       <div className="container" style={{ maxWidth: 800, marginTop: 30 }}>
         {worker.suspended && (
           <div className="takedown-banner">
             <div>
               <strong>This profile was suspended by an admin</strong>
               {worker.suspendReason ? ` Reason: ${worker.suspendReason}` : ''}
               {isSelf ? ' Contact support if you think this was a mistake.' : ''}
             </div>
           </div>
         )}
   
         <div className="card">
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
             <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
               <PersonAvatar src={worker.profilePhoto} size={72} />
               <div>
                 <h1 style={{ marginBottom: 4 }}>
                   {worker.name} {worker.verified && <VerifiedBadge />} {worker.suspended && <SuspendedBadge />}
                 </h1>
                 <div className="biz-name">{worker.skillCategories || 'General worker'}</div>
                 {worker.ratingCount > 0 && <StarRating value={worker.avgRating} count={worker.ratingCount} size={16} />}
                 {distanceKm != null && <div style={{ marginTop: 4 }}><DistanceChip km={distanceKm} /></div>}
               </div>
             </div>
             {worker.availableNow && !worker.suspended && <span className="badge badge-active">🟢 {t('availableNow')}</span>}
           </div>
   
           <div className="spec-list" style={{ marginTop: 16 }}>
             <div className="spec-row"><span className="label">Experience</span><span className="val">{worker.experienceYears || '—'}</span></div>
             <div className="spec-row"><span className="label">Phone</span><span className="val">{worker.phone ? <a href={`tel:${worker.phone}`}>{worker.phone}</a> : '—'}</span></div>
             {worker.publicEmail && (
               <div className="spec-row"><span className="label">Email</span><span className="val"><a href={`mailto:${worker.publicEmail}`}>{worker.publicEmail}</a></span></div>
             )}
             <div className="spec-row"><span className="label">Bio</span><span className="val">{worker.bio || '—'}</span></div>
           </div>
   
           {worker.locationLat != null && worker.locationLng != null && (
             <div className="desc-block">
               <h3>Location</h3>
               <p>{worker.locationAddress || 'Pinned on the map below.'}{distanceKm != null && ` · ${formatDistance(distanceKm)}`}</p>
               <div className="map-wrap">
                 <MapView lat={worker.locationLat} lng={worker.locationLng} height="220px" />
               </div>
               <button
                 className="btn btn-primary btn-block"
                 onClick={openDirections}
                 disabled={directionsLoading}
                 style={{ marginTop: 12 }}
               >
                 {directionsLoading ? 'Getting your location...' : t('getDirections')}
               </button>
               {geo.status === 'denied' && (
                 <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>
                   Location permission denied. You'll need to enter your location manually in Google Maps.
                 </p>
               )}
             </div>
           )}
   
           {resumeImages.length > 0 && (
             <div className="desc-block">
               <h3>Resume</h3>
               <div className="image-preview-grid">
                 {resumeImages.map((src, i) => (
                   <div className="image-preview" key={src} onClick={() => setLightboxIndex(i)} style={{ cursor: 'pointer' }}>
                     <img src={src} alt={`Resume page ${i + 1}`} />
                   </div>
                 ))}
               </div>
             </div>
           )}
   
           {!isSelf && !worker.suspended && (whatsappLink || worker.phone) && (
             <div className="action-row" style={{ display: 'flex', gap: 10, marginTop: 16 }}>
               {whatsappLink && (
                 <a
                   href={whatsappLink}
                   target="_blank"
                   rel="noopener noreferrer"
                   className="btn btn-block"
                   style={{ background: '#25D366', color: '#fff', textAlign: 'center', display: 'block', textDecoration: 'none', padding: '10px 14px', borderRadius: 8 }}
                 >
                   {t('applyWhatsApp')}
                 </a>
               )}
               {worker.phone && (
                 <a
                   href={`tel:${worker.phone}`}
                   className="btn btn-outline btn-block"
                   style={{ textAlign: 'center', display: 'block', textDecoration: 'none', padding: '10px 14px' }}
                 >
                   📞 {worker.phone}
                 </a>
               )}
             </div>
           )}
   
           <div className="desc-block" style={{ marginTop: 20 }}>
             <h3>{t('reviews')}</h3>
             <ReviewsList key={reviewsKey} toUserId={worker.userId} />
             {user && !isSelf && !worker.suspended && (
               <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => setReviewOpen(true)}>{t('writeReview')}</button>
             )}
           </div>
         </div>
   
         {reviewOpen && (
           <ReviewFormModal
             toUserId={worker.userId}
             toRole="worker"
             onClose={() => setReviewOpen(false)}
             onSubmitted={() => { setReviewOpen(false); setReviewsKey((k) => k + 1); load(); toast('Thanks for your review!', 'success'); }}
           />
         )}
   
         <Lightbox
           images={resumeImages}
           index={lightboxIndex}
           onClose={() => setLightboxIndex(null)}
           onNav={(dir) => setLightboxIndex((i) => (i + dir + resumeImages.length) % resumeImages.length)}
         />
       </div>
     );
   }
   
   function MyProfileTab() {
     const { user, updateUserLocal } = useAuth();
     const toast = useToast();
     const t = useT();
     const [form, setForm] = useState(null);
     const [saving, setSaving] = useState(false);
     const [error, setError] = useState(null);
   
     useEffect(() => {
       apiCall('getWorkerProfile', { userId: user.userId }).then((d) => setForm(d.user)).catch((e) => setError(e.message));
     }, [user.userId]);
   
     if (error && !form) return <ErrorState message={error} />;
     if (!form) return <Spinner label="Loading your profile..." />;
   
     const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
     const hasLocation = form.locationLat != null && form.locationLng != null;
     const needsWorkerLocation = form.userType === 'worker' || form.userType === 'both';
     const needsWorkerPhone = form.userType === 'worker' || form.userType === 'both';
   
     const save = async () => {
       // FIX: previously you could save with only a typed address and no
       // map pin — the address text saved fine, but "Workers near you"
       // needs real coordinates, so those profiles were invisible there.
       if (needsWorkerLocation && !hasLocation) {
         setError('Please pin your location on the map below before saving — an address alone isn\'t enough for "Workers near you" to find you.');
         return;
       }
       // Phone is mandatory for any account that can show up as a worker,
       // since it's the primary way businesses reach out from "Find Workers".
       if (needsWorkerPhone && !String(form.phone || '').trim()) {
         setError('A phone number is required so businesses can contact you from "Find Workers".');
         return;
       }
       setSaving(true); setError(null);
       try {
         const d = await apiCall('updateWorkerProfile', {
           userId: user.userId, userType: form.userType, skillCategories: form.skillCategories,
           experienceYears: form.experienceYears, bio: form.bio, availableNow: form.availableNow,
           locationLat: form.locationLat, locationLng: form.locationLng, locationAddress: form.locationAddress,
           phone: form.phone, publicEmail: form.publicEmail, profilePhoto: form.profilePhoto,
           resumeImages: form.resumeImages || []
         });
         updateUserLocal(d.user);
         setForm(d.user);
         toast('Profile updated.', 'success');
       } catch (err) { setError(err.message); } finally { setSaving(false); }
     };
   
     const referralLink = `${typeof window !== 'undefined' ? window.location.origin : ''}?ref=${form.referralCode}`;
   
     return (
       <div className="card" style={{ maxWidth: 640 }}>
         {form.suspended && (
           <div className="takedown-banner" style={{ marginBottom: 16 }}>
             <div>
               <strong>Your profile has been suspended by an admin</strong>
               {form.suspendReason ? ` Reason: ${form.suspendReason}` : ''} You can still edit your details below, but you won't appear in "Workers near you" until an admin restores your profile.
             </div>
           </div>
         )}
   
         <div className="form-section-title">Profile photo</div>
         <ProfilePhotoUploader photo={form.profilePhoto} onChange={(url) => set('profilePhoto', url)} />
   
         <div className="form-section-title" style={{ marginTop: 22 }}>Profile type</div>
         <div className="field">
           <label>I am a</label>
           <select value={form.userType} onChange={(e) => set('userType', e.target.value)}>
             {USER_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
           </select>
           <div className="field-hint" style={{ marginTop: 4 }}>
             "Business / Employer" and "Both" can post worker requirements. A pure "Job Seeker (Worker)" account browses and applies but can't post.
           </div>
         </div>
   
         <div className="form-section-title">Contact details</div>
         <div className="field">
           <label>Phone number {needsWorkerPhone && <span style={{ color: 'var(--danger, #d9363e)' }}>*</span>}</label>
           <input value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} placeholder="10-digit mobile number" />
           {needsWorkerPhone && (
             <div className="field-hint" style={{ marginTop: 4 }}>
               Required — shown to businesses in "Find Workers" so they can call or WhatsApp you.
             </div>
           )}
         </div>
         <div className="field">
           <label>Public email (optional)</label>
           <input type="email" value={form.publicEmail || ''} onChange={(e) => set('publicEmail', e.target.value)} placeholder="e.g. yourname@email.com" />
           <div className="field-hint" style={{ marginTop: 4 }}>
             Optional — shown on your public profile. Leave blank if you don't want to share an email.
           </div>
         </div>
   
         {(form.userType === 'worker' || form.userType === 'both') && (
           <>
             <div className="form-section-title">Worker profile (shown when businesses browse workers)</div>
             <div className="field">
               <label>Skill categories</label>
               <input value={form.skillCategories || ''} onChange={(e) => set('skillCategories', e.target.value)} placeholder="e.g. Electrician, Driver" />
             </div>
             <div className="field">
               <label>Experience</label>
               <input value={form.experienceYears || ''} onChange={(e) => set('experienceYears', e.target.value)} placeholder="e.g. 3 years" />
             </div>
             <div className="field">
               <label>Short bio</label>
               <textarea value={form.bio || ''} onChange={(e) => set('bio', e.target.value)} placeholder="Tell businesses a bit about yourself..." />
             </div>
             <div className="field">
               <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <input type="checkbox" checked={!!form.availableNow} onChange={(e) => set('availableNow', e.target.checked)} />
                 🟢 {t('availableNow')} — show me to businesses searching for workers
               </label>
             </div>
   
             <div className="field">
               <label>Resume (optional)</label>
               <div className="field-hint" style={{ marginBottom: 8 }}>
                 Add photos of your resume, certificates, or ID proof — businesses can view these on your profile. You can add several.
               </div>
               <ImageUploader
                 images={form.resumeImages || []}
                 onChange={(updater) => setForm((f) => ({
                   ...f,
                   resumeImages: typeof updater === 'function' ? updater(f.resumeImages || []) : updater
                 }))}
               />
             </div>
   
             <div className="field">
               <label>Your location</label>
               {!hasLocation && (
                 <div className="profile-location-prompt">
                   📍 You haven't pinned a location yet — businesses searching "Workers near you" and sorting by distance won't be able to find you until you do. Pick your location on the map below (typing an address alone isn't enough).
                 </div>
               )}
               <div className="field-hint" style={{ marginBottom: 8 }}>
                 This is used to show you in "Workers near you" search results and to let businesses see roughly how far you are.
               </div>
               <LocationPicker
                 lat={form.locationLat} lng={form.locationLng} address={form.locationAddress}
                 onChange={(lat, lng, address) => setForm((f) => ({ ...f, locationLat: lat, locationLng: lng, locationAddress: address }))}
               />
             </div>
           </>
         )}
   
         {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
         <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save profile'}</button>
   
         <div className="form-section-title" style={{ marginTop: 26 }}>{t('referral')}</div>
         <div className="spec-list">
           <div className="spec-row"><span className="label">Code</span><span className="val mono">{form.referralCode}</span></div>
           <div className="spec-row"><span className="label">Share link</span><span className="val mono" style={{ wordBreak: 'break-all' }}>{referralLink}</span></div>
         </div>
         <p style={{ fontSize: 12, color: 'var(--text-mute)' }}>Share this code with friends — when they sign up and mention it, they're linked as your referral.</p>
       </div>
     );
   }
   
   // ==============================================================
   // USER DASHBOARD
   // ==============================================================
   function UserDashboardPage({ navigate }) {
     const { user } = useAuth();
     // Worker-only accounts can't post ads, so "My posted ads" would
     // otherwise be the default while being invisible to them — default
     // to "Saved advertisements" instead. Business/both/admin still
     // default to "My posted ads".
     const [tab, setTab] = useState(() => (canPostAds(user) ? 'myads' : 'saved'));
     const [menuOpen, setMenuOpen] = useState(false);
   
     const tabDefs = [
       ...(canPostAds(user) ? [{ id: 'myads', label: 'My posted ads' }] : []),
       { id: 'saved', label: 'Saved advertisements' },
       { id: 'reports', label: 'My reports' },
       { id: 'profile', label: 'My Profile' },
     ];
     const currentLabel = (tabDefs.find((tb) => tb.id === tab) || {}).label || 'My dashboard';
   
     return (
       <div className="container form-page" style={{ maxWidth: 1000 }}>
         <h1>My dashboard</h1>
         <p style={{ color: 'var(--text-mute)', marginBottom: 20 }}>Welcome back, {user.name}.</p>
   
         <div className="section-head" style={{ marginTop: 0, marginBottom: 18 }}>
           <h2 style={{ fontSize: 20 }}>{currentLabel}</h2>
           <button className="btn btn-outline filters-toggle-btn" onClick={() => setMenuOpen(true)}>
             ☰ Menu
           </button>
         </div>
   
         {tab === 'myads' && canPostAds(user) && <MyAdsTab navigate={navigate} />}
         {tab === 'saved' && <SavedAdsTab navigate={navigate} />}
         {tab === 'reports' && <MyReportsTab />}
         {tab === 'profile' && <MyProfileTab />}
   
         <FilterDrawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Dashboard menu">
           <div className="drawer-tab-list">
             {tabDefs.map((tb) => (
               <button
                 key={tb.id}
                 className={`drawer-tab-btn ${tab === tb.id ? 'active' : ''}`}
                 onClick={() => { setTab(tb.id); setMenuOpen(false); }}
               >
                 {tb.label}
               </button>
             ))}
           </div>
         </FilterDrawer>
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
         <p style={{ color: 'var(--text-mute)', marginBottom: 12 }}>
           You have full access as a normal user (browse jobs, browse workers, post ads) plus moderation tools below.
         </p>
         <div className="tabs">
           <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
           <button className={`tab ${tab === 'ads' ? 'active' : ''}`} onClick={() => setTab('ads')}>Advertisements</button>
           <button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>Reports</button>
           <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users & Profiles</button>
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
           <div className="stat-card success"><div className="num">{stats.urgentAds}</div><div className="lbl">🔥 Urgent ads</div></div>
           <div className="stat-card success"><div className="num">{stats.totalWorkersRequested}</div><div className="lbl">Workers currently sought</div></div>
           <div className="stat-card"><div className="num">{stats.totalUsers}</div><div className="lbl">Registered users</div></div>
           <div className="stat-card"><div className="num">{stats.verifiedUsers}</div><div className="lbl">Verified users</div></div>
           <div className="stat-card danger"><div className="num">{stats.suspendedUsers != null ? stats.suspendedUsers : '—'}</div><div className="lbl">Suspended profiles</div></div>
           <div className="stat-card"><div className="num">{stats.workersWithLocation != null ? stats.workersWithLocation : '—'}</div><div className="lbl">Workers with location set</div></div>
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
                 <td>{ad.jobTitle} {ad.urgent && <span title="Urgent">🔥</span>}</td>
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
     const toast = useToast();
     const [users, setUsers] = useState(null);
     const [error, setError] = useState(null);
     const [busyId, setBusyId] = useState(null);
   
     const load = useCallback(() => {
       setUsers(null); setError(null);
       apiCall('getAllUsers', { adminId: user.userId }).then((d) => setUsers(d.users)).catch((e) => setError(e.message));
     }, [user.userId]);
   
     useEffect(() => { load(); }, [load]);
   
     const toggleVerified = async (u) => {
       setBusyId(u.userId);
       try {
         await apiCall('verifyUser', { adminId: user.userId, userId: u.userId, verified: !u.verified });
         toast(u.verified ? 'Verification removed.' : 'User verified.', 'success');
         load();
       } catch (err) { toast(err.message, 'error'); } finally { setBusyId(null); }
     };
   
     // NEW: suspend/restore a worker or business profile — hides them
     // from public "Find Workers" search and flags their profile page.
     const toggleSuspended = async (u) => {
       setBusyId(u.userId);
       try {
         if (u.suspended) {
           await apiCall('restoreUserProfile', { adminId: user.userId, userId: u.userId });
           toast('Profile restored.', 'success');
         } else {
           const reason = prompt('Reason for suspending this profile (shown to the user):', 'This profile was suspended by an admin.');
           if (reason === null) { setBusyId(null); return; }
           await apiCall('suspendUser', { adminId: user.userId, userId: u.userId, suspendReason: reason });
           toast('Profile suspended.', 'success');
         }
         load();
       } catch (err) { toast(err.message, 'error'); } finally { setBusyId(null); }
     };
   
     if (error) return <ErrorState message={error} />;
     if (!users) return <Spinner label="Loading users..." />;
   
     return (
       <div className="table-wrap">
         <table>
           <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Type</th><th>Location</th><th>Rating</th><th>Status</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
           <tbody>
             {users.map((u) => (
               <tr key={u.userId}>
                 <td>{u.name} {u.verified && <VerifiedBadge small />}</td>
                 <td>{u.email}</td><td>{u.phone || '—'}</td>
                 <td>{u.userType || '—'}</td>
                 <td>{u.locationAddress || (u.locationLat != null ? 'Pinned, no address' : '—')}</td>
                 <td>{u.ratingCount > 0 ? <StarRating value={u.avgRating} count={u.ratingCount} /> : '—'}</td>
                 <td>{u.suspended ? <SuspendedBadge small /> : <span style={{ color: 'var(--success, #1a9d5c)', fontSize: 12 }}>Active</span>}</td>
                 <td>{u.role === 'admin' ? <span className="badge badge-admin">Admin</span> : 'User'}</td>
                 <td className="mono">{new Date(u.createdAt).toLocaleDateString()}</td>
                 <td className="row-actions">
                   {u.role !== 'admin' && (
                     <>
                       <button className="btn btn-outline btn-sm" disabled={busyId === u.userId} onClick={() => toggleVerified(u)}>
                         {u.verified ? 'Unverify' : 'Verify'}
                       </button>
                       <button
                         className={`btn btn-sm ${u.suspended ? 'btn-success' : 'btn-danger'}`}
                         disabled={busyId === u.userId}
                         onClick={() => toggleSuspended(u)}
                         style={{ marginLeft: 6 }}
                       >
                         {u.suspended ? 'Restore profile' : 'Suspend profile'}
                       </button>
                     </>
                   )}
                 </td>
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
     const t = useT();
     const [mode, setMode] = useState(initialMode || 'login');
     const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', userType: 'worker', referredBy: '' });
     const [busy, setBusy] = useState(false);
     const [error, setError] = useState(null);
   
     useEffect(() => {
       try {
         const params = new URLSearchParams(window.location.search);
         const ref = params.get('ref');
         if (ref) setForm((f) => ({ ...f, referredBy: ref }));
       } catch (e) {}
     }, []);
   
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
           <h2>{mode === 'login' ? t('login') : 'Create your account'}</h2>
           <div className="sub">{mode === 'login' ? 'Access your dashboard and saved jobs.' : 'Post job requirements or apply to local jobs.'}</div>
           <form onSubmit={submit}>
             {mode === 'register' && (
               <div className="field"><label>Full name</label><input required value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
             )}
             <div className="field"><label>Email</label><input required type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
             {mode === 'register' && (
               <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
             )}
             {mode === 'register' && (
               <div className="field">
                 <label>I am a</label>
                 <select value={form.userType} onChange={(e) => set('userType', e.target.value)}>
                   {USER_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                 </select>
                 <div className="field-hint" style={{ marginTop: 4 }}>
                   Business and Both accounts can post worker requirements; you can change this later in My Profile.
                 </div>
               </div>
             )}
             <div className="field"><label>Password</label><input required type="password" value={form.password} onChange={(e) => set('password', e.target.value)} /></div>
             {mode === 'register' && (
               <div className="field"><label>Referral code (optional)</label>
                 <input value={form.referredBy} onChange={(e) => set('referredBy', e.target.value)} placeholder="e.g. AB12CD" /></div>
             )}
   
             {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}
             <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Please wait...' : (mode === 'login' ? t('login') : t('signup'))}</button>
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