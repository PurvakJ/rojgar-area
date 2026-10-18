/**
 * ROJGAR AREA — Backend (Google Apps Script)  — v5
 * ------------------------------------------------------------
 * Sheets used (auto-created by setupSheets()):
 *   Users, Advertisements, SavedAds, Reports, AdminLogs, Reviews,
 *   Sponsorships (NEW in v5 — see below)
 *
 * DEPLOY:
 *   1. Extensions > Apps Script in your Google Sheet, paste this file as Code.gs
 *   2. Run setupSheets() once (select it in the dropdown, click Run, grant permissions)
 *   3. Deploy > New deployment > type "Web app"
 *        - Execute as: Me
 *        - Who has access: Anyone
 *   4. Copy the Web App URL into app.js -> CONFIG.APPS_SCRIPT_URL
 *
 *   NOTE: if you're upgrading an existing sheet from an earlier version,
 *   just re-run setupSheets() — it PHYSICALLY inserts any missing columns
 *   (via migrateSheetColumns) instead of only relabeling the header row,
 *   so existing data never shifts into the wrong column. NONE of your
 *   existing sheets (Users, Advertisements, SavedAds, Reports, AdminLogs,
 *   Reviews) need any column changes for this version — the entire
 *   "Featured / Sponsored Advertisement" feature lives in a brand-new
 *   "Sponsorships" sheet that setupSheets() will create for you
 *   automatically the next time you run it. Nothing in any existing
 *   sheet is touched, migrated, or reordered because of this feature.
 *
 * STATUS MODEL for Advertisements.status:
 *   'active'      -> visible on the public board, owner-controlled
 *   'inactive'    -> hidden by the owner (paused), owner can reactivate
 *   'taken_down'  -> removed by an admin after a report review; only an
 *                    admin can restore it (owner cannot reactivate this one)
 *
 * ADMIN LOGIN:
 *   setupSheets() auto-creates a default admin account THE FIRST TIME IT
 *   RUNS, but only if no row in Users already has role === 'admin':
 *       email: admin@rojgararea.local
 *       password: admin123
 *   If you get "No account found with this email" when logging in as
 *   admin, run debugFindAdmin() (see bottom of this file) to check
 *   whether an admin row already exists on THIS sheet, and
 *   resetAdminPassword() to force it back to admin123 if you've lost it.
 *
 * ============================================================
 * NEW IN v5 — SPONSORED / FEATURED ADVERTISEMENTS
 * ============================================================
 *   - Businesses pay (via Razorpay Checkout, entirely client-side — see
 *     app.js's SponsorAdModal) to "feature" one of their own active
 *     advertisements for a fixed period:
 *         1 month  -> ₹100
 *         3 months -> ₹200
 *         6 months -> ₹300
 *         1 year   -> ₹500
 *   - This backend NEVER talks to Razorpay and never verifies the
 *     payment itself — by design, per the requested flow, the frontend
 *     only calls this backend AFTER Razorpay's client-side handler has
 *     already confirmed a successful payment. All this backend does is
 *     record "this ad is sponsored until <date>, paid <amount>, plan
 *     <planId>, Razorpay payment id <paymentId>" in a new dedicated
 *     "Sponsorships" sheet — nothing more.
 *   - A brand-new "Sponsorships" sheet holds this data. No column was
 *     added to, removed from, or reordered on any pre-existing sheet —
 *     Users, Advertisements, SavedAds, Reports, AdminLogs and Reviews
 *     are all completely untouched by this feature.
 *   - Every ad object returned by getAds / getAdById / createAd / getMyAds
 *     / getSavedAds / getAllAds (admin) now also carries:
 *         sponsored       (bool)      — true if currently featured
 *         sponsoredUntil  (ISO date or '') — when the current feature ends
 *     computed by cross-referencing the Sponsorships sheet — the
 *     Advertisements sheet itself stores nothing about sponsorship.
 *   - getDashboardStats (admin overview) now also reports:
 *         activeSponsorships        — count of ads currently featured
 *         totalSponsorshipRevenue   — sum of all sponsorship payments ever recorded
 * ------------------------------------------------------------
 */

// ============================================================
// CONFIG
// ============================================================
var SHEET_NAMES = {
    USERS: 'Users',
    ADS: 'Advertisements',
    SAVED: 'SavedAds',
    REPORTS: 'Reports',
    ADMIN_LOGS: 'AdminLogs',
    REVIEWS: 'Reviews',
    // NEW (v5): dedicated sheet for sponsored/featured ad records.
    SPONSORSHIPS: 'Sponsorships'
  };
  
  var HEADERS = {
    Users: [
      'userId', 'name', 'email', 'phone', 'passwordHash', 'role', 'createdAt',
      // worker/profile fields
      'userType', 'skillCategories', 'experienceYears', 'bio', 'profilePhoto',
      'availableNow',
      // worker location (used for "workers near you" distance search)
      'locationLat', 'locationLng', 'locationAddress',
      'verified',
      // admin-controlled profile suspension
      'suspended', 'suspendReason', 'suspendedAt',
      'avgRating', 'ratingCount',
      // referrals
      'referralCode', 'referredBy'
    ],
    Advertisements: [
      'adId', 'businessName', 'businessType', 'customBusinessType', 'jobTitle', 'workerCategory', 'customCategory',
      'numWorkers', 'salary', 'education', 'experience', 'skills',
      'workingHours', 'description', 'images', 'locationLat', 'locationLng',
      'locationAddress', 'postedBy', 'postedByName', 'contactPhone', 'postedAt', 'updatedAt',
      'status', 'takedownReason', 'takedownAt', 'urgent'
    ],
    SavedAds: ['id', 'userId', 'adId', 'savedAt'],
    Reports: [
      'reportId', 'adId', 'userId', 'userName', 'reason', 'description',
      'status', 'reportedAt', 'reviewedBy', 'reviewedAt', 'reviewNote'
    ],
    AdminLogs: ['logId', 'adminId', 'action', 'targetId', 'note', 'timestamp'],
    Reviews: [
      'reviewId', 'adId', 'fromUserId', 'fromUserName', 'toUserId', 'toRole',
      'rating', 'comment', 'createdAt'
    ],
    // NEW (v5): one row per sponsorship purchase. An ad can have several
    // rows over time (e.g. renewed multiple times) — the "currently
    // sponsored" status is always computed as "is there any row for this
    // adId whose endAt is in the future", taking the LATEST endAt if more
    // than one is still active (e.g. a renewal purchased before the
    // previous period ended).
    Sponsorships: [
      'sponsorshipId', 'adId', 'postedBy', 'planId', 'planLabel', 'days',
      'amount', 'paymentId', 'startAt', 'endAt', 'createdAt'
    ]
  };
  
  // Mirrors the frontend's SPONSORSHIP_PLANS (app.js CONFIG). Used only to
  // validate/label incoming createSponsorship requests — if you change
  // pricing/duration on the frontend, update this list to match.
  var SPONSORSHIP_PLANS = [
    { id: '1m', label: '1 Month', days: 30, price: 100 },
    { id: '3m', label: '3 Months', days: 90, price: 200 },
    { id: '6m', label: '6 Months', days: 180, price: 300 },
    { id: '1y', label: '1 Year', days: 365, price: 500 }
  ];
  
  // ============================================================
  // ENTRY POINTS
  // ============================================================
  function doGet(e) {
    return handleRequest(e);
  }
  
  function doPost(e) {
    return handleRequest(e);
  }
  
  function handleRequest(e) {
    var params = {};
    try {
      if (e && e.postData && e.postData.contents) {
        params = JSON.parse(e.postData.contents);
      } else if (e && e.parameter) {
        params = e.parameter;
      }
  
      var action = params.action;
      var result;
  
      switch (action) {
        case 'register': result = registerUser(params); break;
        case 'login': result = loginUser(params); break;
  
        case 'getAds': result = getActiveAds(params); break;
        case 'getAdById': result = getAdByIdApi(params); break;
        case 'createAd': result = createAd(params); break;
        case 'updateAd': result = updateAd(params); break;
        case 'getMyAds': result = getMyAds(params); break;
        case 'toggleAdStatus': result = toggleAdStatus(params); break;
        case 'deleteAd': result = deleteAd(params); break;
  
        case 'saveAd': result = saveAd(params); break;
        case 'removeSavedAd': result = removeSavedAd(params); break;
        case 'getSavedAds': result = getSavedAds(params); break;
  
        case 'submitReport': result = submitReport(params); break;
        case 'getUserReports': result = getUserReports(params); break;
  
        case 'getAllAds': result = getAllAdsAdmin(params); break;
        case 'getAllUsers': result = getAllUsersAdmin(params); break;
        case 'getAllReports': result = getAllReportsAdmin(params); break;
        case 'reviewReport': result = reviewReport(params); break;
        case 'takedownAd': result = takedownAd(params); break;
        case 'restoreAd': result = restoreAd(params); break;
        case 'getDashboardStats': result = getDashboardStats(params); break;
  
        // ---- worker profiles ----
        case 'updateWorkerProfile': result = updateWorkerProfile(params); break;
        case 'getWorkerProfile': result = getWorkerProfile(params); break;
        case 'searchWorkers': result = searchWorkers(params); break;
  
        // ---- reviews & ratings ----
        case 'submitReview': result = submitReview(params); break;
        case 'getUserReviews': result = getUserReviews(params); break;
  
        // ---- admin verification / moderation ----
        case 'verifyUser': result = verifyUser(params); break;
        case 'suspendUser': result = suspendUser(params); break;
        case 'restoreUserProfile': result = restoreUserProfile(params); break;
  
        // ---- salary benchmarking ----
        case 'getSalaryBenchmark': result = getSalaryBenchmark(params); break;
  
        // ---- sponsorship / featured ads (NEW v5) ----
        case 'createSponsorship': result = createSponsorship(params); break;
  
        default: result = { success: false, message: 'Unknown action: ' + action };
      }
      return jsonOutput(result);
    } catch (err) {
      return jsonOutput({ success: false, message: 'Server error: ' + err.message });
    }
  }
  
  function jsonOutput(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // ============================================================
  // SETUP - Run this function first! (safe to re-run any time)
  // ============================================================
  
  // Physically inserts any header column that's missing from the sheet,
  // at the position it belongs in HEADERS[...], instead of just relabeling
  // row 1 (which is what silently corrupted existing rows in earlier
  // versions whenever a new field was added in the middle of the list).
  function migrateSheetColumns(sheet, headers) {
    var lastCol = sheet.getLastColumn();
    var existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  
    headers.forEach(function (h, targetIdx) {
      var currentIdx = existingHeaders.indexOf(h);
      if (currentIdx !== -1) return; // already present, leave it where it is
  
      var insertBeforeCol = targetIdx + 1; // 1-based column to insert before
      if (insertBeforeCol > existingHeaders.length + 1) {
        insertBeforeCol = existingHeaders.length + 1;
      }
      if (insertBeforeCol > existingHeaders.length) {
        // Inserting at the very end — no need to shift anything, just write the header.
        sheet.getRange(1, insertBeforeCol).setValue(h);
      } else {
        sheet.insertColumnBefore(insertBeforeCol);
        sheet.getRange(1, insertBeforeCol).setValue(h);
      }
      existingHeaders.splice(insertBeforeCol - 1, 0, h);
    });
  }
  
  function setupSheets() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
  
      Object.keys(HEADERS).forEach(function (name) {
        var sheet = ss.getSheetByName(name);
        var headers = HEADERS[name];
  
        if (!sheet) {
          sheet = ss.insertSheet(name);
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.setFrozenRows(1);
          sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
          Logger.log('Created sheet: ' + name);
          return;
        }
  
        // Migrate first: physically insert any columns that are missing,
        // preserving existing data in existing columns.
        migrateSheetColumns(sheet, headers);
  
        // After migration every header in HEADERS should exist somewhere in
        // row 1, but not necessarily in the canonical order (e.g. a column
        // a previous version added at the end). We only reorder if row 1
        // doesn't already match; reordering is done via a safe re-read/
        // re-write of the whole sheet rather than moving columns in place.
        var currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        var alreadyInOrder = headers.every(function (h, i) { return currentHeaders[i] === h; });
  
        if (!alreadyInOrder) {
          var data = sheet.getDataRange().getValues();
          var oldHeaders = data[0];
          var rows = data.slice(1);
          var reordered = rows.map(function (row) {
            return headers.map(function (h) {
              var idx = oldHeaders.indexOf(h);
              return idx === -1 ? '' : row[idx];
            });
          });
          sheet.clearContents();
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          if (reordered.length > 0) {
            sheet.getRange(2, 1, reordered.length, headers.length).setValues(reordered);
          }
          sheet.setFrozenRows(1);
          sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
          Logger.log('Reordered/repaired headers for sheet: ' + name);
        }
      });
  
      var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
      var users = sheetToObjects(usersSheet);
      var hasAdmin = users.some(function (u) { return u.role === 'admin'; });
  
      if (!hasAdmin) {
        var adminUser = {
          userId: Utilities.getUuid(),
          name: 'Administrator',
          email: 'admin@rojgararea.local',
          phone: '',
          passwordHash: hashPassword('admin123'),
          role: 'admin',
          createdAt: new Date().toISOString(),
          userType: 'both',
          skillCategories: '',
          experienceYears: '',
          bio: '',
          profilePhoto: '',
          availableNow: false,
          locationLat: '',
          locationLng: '',
          locationAddress: '',
          verified: true,
          suspended: false,
          suspendReason: '',
          suspendedAt: '',
          avgRating: 0,
          ratingCount: 0,
          referralCode: genReferralCode(),
          referredBy: ''
        };
        appendRowObject(usersSheet, HEADERS.Users, adminUser);
        Logger.log('Created default admin user (admin@rojgararea.local / admin123)');
      }
  
      Logger.log('Setup complete! All sheets created/migrated successfully.');
      return 'Setup complete';
  
    } catch (error) {
      Logger.log('Error in setup: ' + error.toString());
      throw error;
    }
  }
  
  // ============================================================
  // GENERIC SHEET HELPERS
  // ============================================================
  function getSheet(name) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      try {
        sheet = ss.insertSheet(name);
        var headers = HEADERS[name];
        if (headers) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.setFrozenRows(1);
          sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
        }
        Logger.log('Auto-created missing sheet: ' + name);
        return sheet;
      } catch (e) {
        throw new Error('Sheet not found: ' + name + '. Run setupSheets() first. Error: ' + e.message);
      }
    }
    return sheet;
  }
  
  function sheetToObjects(sheet) {
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    var headers = data[0];
    var rows = data.slice(1);
    return rows
      .filter(function (row) { return row.join('') !== ''; })
      .map(function (row) {
        var obj = {};
        headers.forEach(function (h, i) { obj[h] = row[i]; });
        return obj;
      });
  }
  
  function appendRowObject(sheet, headers, obj) {
    var row = headers.map(function (h) {
      return obj.hasOwnProperty(h) ? obj[h] : '';
    });
    sheet.appendRow(row);
  }
  
  function findRowIndexById(sheet, idCol, idVal) {
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colIdx = headers.indexOf(idCol);
    if (colIdx === -1) return -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][colIdx]) === String(idVal)) return i + 1; // 1-based sheet row
    }
    return -1;
  }
  
  function updateRowById(sheet, headers, idCol, idVal, updates) {
    var rowIndex = findRowIndexById(sheet, idCol, idVal);
    if (rowIndex === -1) return false;
    var currentRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    headers.forEach(function (h, i) {
      if (updates.hasOwnProperty(h)) {
        // Normalize null/undefined to '' so Sheets doesn't choke on nulls
        currentRow[i] = (updates[h] === null || updates[h] === undefined) ? '' : updates[h];
      }
    });
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([currentRow]);
    return true;
  }
  
  function deleteRowById(sheet, idCol, idVal) {
    var rowIndex = findRowIndexById(sheet, idCol, idVal);
    if (rowIndex === -1) return false;
    sheet.deleteRow(rowIndex);
    return true;
  }
  
  function hashPassword(password) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password));
    return digest.map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
  }
  
  function genReferralCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    for (var i = 0; i < 6; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }
  
  function parseSalaryNumber(s) {
    if (!s) return 0;
    var nums = String(s).match(/\d+/g);
    if (!nums) return 0;
    var max = 0;
    nums.forEach(function (n) { var v = Number(n); if (v > max) max = v; });
    return max;
  }
  
  function numOrNull(v) {
    return (v !== '' && v !== undefined && v !== null) ? Number(v) : null;
  }
  
  function boolOf(v) {
    return v === true || v === 'TRUE' || v === 'true';
  }
  
  function sanitizeUser(u) {
    return {
      userId: u.userId, name: u.name, email: u.email,
      phone: u.phone, role: u.role, createdAt: u.createdAt,
      userType: u.userType || 'worker',
      skillCategories: u.skillCategories || '',
      experienceYears: u.experienceYears || '',
      bio: u.bio || '',
      profilePhoto: u.profilePhoto || '',
      availableNow: boolOf(u.availableNow),
      // worker/user location — null when not set, so the frontend can
      // tell "no location" apart from "location is (0,0)".
      locationLat: numOrNull(u.locationLat),
      locationLng: numOrNull(u.locationLng),
      locationAddress: u.locationAddress || '',
      verified: boolOf(u.verified),
      // admin-controlled profile suspension
      suspended: boolOf(u.suspended),
      suspendReason: u.suspendReason || '',
      suspendedAt: u.suspendedAt || '',
      avgRating: Number(u.avgRating) || 0,
      ratingCount: Number(u.ratingCount) || 0,
      referralCode: u.referralCode || ''
      // referredBy intentionally omitted from public payloads
    };
  }
  
  function canUserPostAds(userId) {
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var user = users.find(function (u) { return u.userId === userId; });
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.userType === 'business' || user.userType === 'both';
  }
  
  // ============================================================
  // AUTH
  // ============================================================
  function registerUser(params) {
    var name = (params.name || '').trim();
    var email = (params.email || '').trim().toLowerCase();
    var phone = (params.phone || '').trim();
    var password = params.password || '';
    var userType = params.userType || 'worker'; // 'worker' | 'business' | 'both'
    var referredByCode = (params.referredBy || '').trim().toUpperCase();
  
    if (!name || !email || !password) {
      return { success: false, message: 'Name, email and password are required.' };
    }
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var exists = users.some(function (u) { return String(u.email).toLowerCase() === email; });
    if (exists) return { success: false, message: 'An account with this email already exists.' };
  
    var referrer = null;
    if (referredByCode) {
      referrer = users.find(function (u) { return String(u.referralCode).toUpperCase() === referredByCode; });
    }
  
    var newUser = {
      userId: Utilities.getUuid(),
      name: name,
      email: email,
      phone: phone,
      passwordHash: hashPassword(password),
      role: 'user',
      createdAt: new Date().toISOString(),
      userType: userType,
      skillCategories: params.skillCategories || '',
      experienceYears: params.experienceYears || '',
      bio: '',
      profilePhoto: '',
      availableNow: userType !== 'business',
      locationLat: '',
      locationLng: '',
      locationAddress: '',
      verified: false,
      suspended: false,
      suspendReason: '',
      suspendedAt: '',
      avgRating: 0,
      ratingCount: 0,
      referralCode: genReferralCode(),
      referredBy: referrer ? referrer.userId : ''
    };
    appendRowObject(sheet, HEADERS.Users, newUser);
    return { success: true, user: sanitizeUser(newUser) };
  }
  
  function loginUser(params) {
    var email = (params.email || '').trim().toLowerCase();
    var password = params.password || '';
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var user = users.find(function (u) { return String(u.email).toLowerCase() === email; });
    if (!user) return { success: false, message: 'No account found with this email.' };
    if (user.passwordHash !== hashPassword(password)) {
      return { success: false, message: 'Incorrect password.' };
    }
    return { success: true, user: sanitizeUser(user) };
  }
  
  // ============================================================
  // WORKER PROFILES
  // ============================================================
  function updateWorkerProfile(params) {
    if (!params.userId) return { success: false, message: 'userId is required.' };
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var user = users.find(function (u) { return u.userId === params.userId; });
    if (!user) return { success: false, message: 'User not found.' };
  
    var updates = {};
    var editable = [
      'userType', 'skillCategories', 'experienceYears', 'bio', 'profilePhoto', 'availableNow',
      // worker location fields, editable from "My Profile"
      'locationLat', 'locationLng', 'locationAddress'
    ];
    editable.forEach(function (f) { if (params.hasOwnProperty(f)) updates[f] = params[f]; });
  
    updateRowById(sheet, HEADERS.Users, 'userId', params.userId, updates);
    var updated = Object.assign({}, user, updates);
    return { success: true, user: sanitizeUser(updated) };
  }
  
  function getWorkerProfile(params) {
    if (!params.userId) return { success: false, message: 'userId is required.' };
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var user = users.find(function (u) { return u.userId === params.userId; });
    if (!user) return { success: false, message: 'Worker not found.' };
    return { success: true, user: sanitizeUser(user) };
  }
  
  function searchWorkers(params) {
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var list = users.filter(function (u) {
      if (u.userType !== 'worker' && u.userType !== 'both') return false;
      if (boolOf(u.suspended)) return false; // suspended profiles are hidden from public search
      return true;
    });
  
    if (params.category) {
      var cat = String(params.category).toLowerCase();
      list = list.filter(function (u) { return String(u.skillCategories || '').toLowerCase().indexOf(cat) !== -1; });
    }
    if (params.search) {
      var q = String(params.search).toLowerCase();
      list = list.filter(function (u) {
        return (String(u.name) + String(u.skillCategories) + String(u.bio)).toLowerCase().indexOf(q) !== -1;
      });
    }
    if (params.availableOnly === true || params.availableOnly === 'true') {
      list = list.filter(function (u) { return boolOf(u.availableNow); });
    }
  
    // Default ordering by rating; the frontend re-sorts client-side by
    // distance when the browsing user has shared their location.
    list.sort(function (a, b) { return (Number(b.avgRating) || 0) - (Number(a.avgRating) || 0); });
    return { success: true, workers: list.map(sanitizeUser) };
  }
  
  // ============================================================
  // SPONSORSHIPS / FEATURED ADVERTISEMENTS (NEW v5)
  // ============================================================
  
  // Builds a map of { adId: { until: <ISO string> } } for every ad that
  // currently has an UNEXPIRED sponsorship row (endAt in the future). If
  // an ad has multiple still-active rows (e.g. renewed before expiry),
  // the latest endAt wins. This is the single source of truth normalizeAd
  // reads from — the Advertisements sheet itself stores nothing about
  // sponsorship, so this is recomputed fresh on every request.
  function getActiveSponsorshipMap() {
    var sheet = getSheet(SHEET_NAMES.SPONSORSHIPS);
    var rows = sheetToObjects(sheet);
    var now = new Date();
    var map = {};
    rows.forEach(function (r) {
      if (!r.adId || !r.endAt) return;
      var end = new Date(r.endAt);
      if (isNaN(end.getTime()) || end <= now) return; // expired or malformed — ignore
      if (!map[r.adId] || new Date(map[r.adId].until) < end) {
        map[r.adId] = { until: (end.toISOString ? end.toISOString() : r.endAt) };
      }
    });
    return map;
  }
  
  // Records a sponsorship purchase. This backend does NOT talk to
  // Razorpay and does NOT verify the payment — the frontend only calls
  // this action after Razorpay's own client-side handler has already
  // confirmed a successful payment (see app.js SponsorAdModal). All this
  // does is: check the ad belongs to the caller, look up the plan's
  // duration/price from SPONSORSHIP_PLANS, and append one row recording
  // "featured until <date>" — nothing more.
  function createSponsorship(params) {
    var required = ['adId', 'postedBy', 'plan', 'paymentId'];
    for (var i = 0; i < required.length; i++) {
      if (!params[required[i]]) return { success: false, message: 'Missing field: ' + required[i] };
    }
  
    var plan = SPONSORSHIP_PLANS.find(function (p) { return p.id === params.plan; });
    if (!plan) return { success: false, message: 'Unknown sponsorship plan: ' + params.plan };
  
    var adsSheet = getSheet(SHEET_NAMES.ADS);
    var ads = sheetToObjects(adsSheet);
    var ad = ads.find(function (a) { return a.adId === params.adId; });
    if (!ad) return { success: false, message: 'Advertisement not found.' };
    if (ad.postedBy !== params.postedBy) {
      return { success: false, message: 'Not authorized to sponsor this advertisement.' };
    }
    if (ad.status !== 'active') {
      return { success: false, message: 'Only active advertisements can be featured.' };
    }
  
    // If the ad already has time remaining on an existing sponsorship,
    // the new period is added on top of (extends) that remaining time
    // instead of overwriting it, so paying early to renew never costs
    // you unused days. Otherwise the new period starts now.
    var sponsorshipMap = getActiveSponsorshipMap();
    var now = new Date();
    var startAt = now;
    if (sponsorshipMap[params.adId] && new Date(sponsorshipMap[params.adId].until) > now) {
      startAt = new Date(sponsorshipMap[params.adId].until);
    }
    var endAt = new Date(startAt.getTime() + plan.days * 24 * 60 * 60 * 1000);
  
    var sponsorshipsSheet = getSheet(SHEET_NAMES.SPONSORSHIPS);
    var record = {
      sponsorshipId: Utilities.getUuid(),
      adId: params.adId,
      postedBy: params.postedBy,
      planId: plan.id,
      planLabel: plan.label,
      days: plan.days,
      amount: params.amount || plan.price,
      paymentId: params.paymentId,
      startAt: now.toISOString(),
      endAt: endAt.toISOString(),
      createdAt: now.toISOString()
    };
    appendRowObject(sponsorshipsSheet, HEADERS.Sponsorships, record);
  
    return {
      success: true,
      sponsorship: record,
      sponsored: true,
      sponsoredUntil: record.endAt
    };
  }
  
  // ============================================================
  // ADVERTISEMENTS
  // ============================================================
  function normalizeAd(ad, usersById, sponsorshipMap) {
    var displayCategory = (ad.workerCategory === 'Other' && ad.customCategory)
      ? ad.customCategory
      : ad.workerCategory;
    // NEW-era field: mirrors displayCategory above, but for Business Type.
    var displayBusinessType = (ad.businessType === 'Other' && ad.customBusinessType)
      ? ad.customBusinessType
      : ad.businessType;
    var poster = usersById ? usersById[ad.postedBy] : null;
    // NEW (v5): sponsorship lookup — sponsorshipMap is optional so any
    // existing call site that forgets to pass it simply gets
    // sponsored:false instead of throwing.
    var sponsorship = (sponsorshipMap && sponsorshipMap[ad.adId]) ? sponsorshipMap[ad.adId] : null;
    return Object.assign({}, ad, {
      images: ad.images ? String(ad.images).split('|').filter(Boolean) : [],
      numWorkers: Number(ad.numWorkers) || 0,
      salary: ad.salary,
      locationLat: numOrNull(ad.locationLat),
      locationLng: numOrNull(ad.locationLng),
      displayCategory: displayCategory,
      displayBusinessType: displayBusinessType,
      urgent: boolOf(ad.urgent),
      businessVerified: poster ? boolOf(poster.verified) : false,
      businessRating: poster ? (Number(poster.avgRating) || 0) : 0,
      businessRatingCount: poster ? (Number(poster.ratingCount) || 0) : 0,
      sponsored: !!sponsorship,
      sponsoredUntil: sponsorship ? sponsorship.until : ''
    });
  }
  
  function getUsersById() {
    var users = sheetToObjects(getSheet(SHEET_NAMES.USERS));
    var map = {};
    users.forEach(function (u) { map[u.userId] = u; });
    return map;
  }
  
  function getActiveAds(params) {
    var sheet = getSheet(SHEET_NAMES.ADS);
    var ads = sheetToObjects(sheet).filter(function (a) { return a.status === 'active'; });
  
    if (params.search) {
      var q = String(params.search).toLowerCase();
      ads = ads.filter(function (a) {
        return (String(a.jobTitle) + String(a.businessName) + String(a.description) + String(a.skills) + String(a.customCategory))
          .toLowerCase().indexOf(q) !== -1;
      });
    }
    ads.sort(function (a, b) { return new Date(b.postedAt) - new Date(a.postedAt); });
    var usersById = getUsersById();
    var sponsorshipMap = getActiveSponsorshipMap();
    return { success: true, ads: ads.map(function (a) { return normalizeAd(a, usersById, sponsorshipMap); }) };
  }
  
  function getAdByIdApi(params) {
    var sheet = getSheet(SHEET_NAMES.ADS);
    var ads = sheetToObjects(sheet);
    var ad = ads.find(function (a) { return a.adId === params.adId; });
    if (!ad) return { success: false, message: 'Advertisement not found.' };
    return { success: true, ad: normalizeAd(ad, getUsersById(), getActiveSponsorshipMap()) };
  }
  
  function createAd(params) {
    var required = ['businessName', 'jobTitle', 'workerCategory', 'postedBy'];
    for (var i = 0; i < required.length; i++) {
      if (!params[required[i]]) return { success: false, message: 'Missing field: ' + required[i] };
    }
    if (params.workerCategory === 'Other' && !String(params.customCategory || '').trim()) {
      return { success: false, message: 'Please describe the worker category.' };
    }
    if (params.businessType === 'Other' && !String(params.customBusinessType || '').trim()) {
      return { success: false, message: 'Please describe your business type.' };
    }
    // Server-side enforcement: only business/both accounts (or admins) may post.
    if (!canUserPostAds(params.postedBy)) {
      return { success: false, message: 'Only business accounts can post worker requirements. Switch your profile type to Business in My Profile.' };
    }
    var sheet = getSheet(SHEET_NAMES.ADS);
    var images = Array.isArray(params.images) ? params.images.join('|') : (params.images || '');
    var newAd = {
      adId: Utilities.getUuid(),
      businessName: params.businessName,
      businessType: params.businessType || '',
      customBusinessType: params.businessType === 'Other' ? (params.customBusinessType || '') : '',
      jobTitle: params.jobTitle,
      workerCategory: params.workerCategory,
      customCategory: params.workerCategory === 'Other' ? (params.customCategory || '') : '',
      numWorkers: params.numWorkers || 1,
      salary: params.salary || '',
      education: params.education || '',
      experience: params.experience || '',
      skills: params.skills || '',
      workingHours: params.workingHours || '',
      description: params.description || '',
      images: images,
      locationLat: params.locationLat || '',
      locationLng: params.locationLng || '',
      locationAddress: params.locationAddress || '',
      postedBy: params.postedBy,
      postedByName: params.postedByName || '',
      contactPhone: params.contactPhone || '',
      postedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
      takedownReason: '',
      takedownAt: '',
      urgent: params.urgent === true || params.urgent === 'true'
    };
    appendRowObject(sheet, HEADERS.Advertisements, newAd);
    return { success: true, ad: normalizeAd(newAd, getUsersById(), {}) };
  }
  
  function updateAd(params) {
    if (!params.adId) return { success: false, message: 'adId is required.' };
    var sheet = getSheet(SHEET_NAMES.ADS);
    var ads = sheetToObjects(sheet);
    var ad = ads.find(function (a) { return a.adId === params.adId; });
    if (!ad) return { success: false, message: 'Advertisement not found.' };
    if (ad.postedBy !== params.postedBy) {
      return { success: false, message: 'Not authorized to edit this advertisement.' };
    }
    if (ad.status === 'taken_down') {
      return { success: false, message: 'This advertisement was taken down by an admin and cannot be edited.' };
    }
    if (params.workerCategory === 'Other' && !String(params.customCategory || '').trim()) {
      return { success: false, message: 'Please describe the worker category.' };
    }
    if (params.businessType === 'Other' && !String(params.customBusinessType || '').trim()) {
      return { success: false, message: 'Please describe your business type.' };
    }
  
    var updates = {};
    var editable = ['businessName', 'businessType', 'customBusinessType', 'jobTitle', 'workerCategory', 'customCategory', 'numWorkers',
      'salary', 'education', 'experience', 'skills', 'workingHours', 'description',
      'locationLat', 'locationLng', 'locationAddress', 'contactPhone', 'urgent'];
    editable.forEach(function (f) { if (params.hasOwnProperty(f)) updates[f] = params[f]; });
    if (params.hasOwnProperty('workerCategory') && params.workerCategory !== 'Other') updates.customCategory = '';
    if (params.hasOwnProperty('businessType') && params.businessType !== 'Other') updates.customBusinessType = '';
    if (params.images) updates.images = Array.isArray(params.images) ? params.images.join('|') : params.images;
    updates.updatedAt = new Date().toISOString();
  
    updateRowById(sheet, HEADERS.Advertisements, 'adId', params.adId, updates);
    return { success: true };
  }
  
  function toggleAdStatus(params) {
    if (!params.adId || !params.userId || !params.status) {
      return { success: false, message: 'adId, userId and status are required.' };
    }
    if (params.status !== 'active' && params.status !== 'inactive') {
      return { success: false, message: 'status must be active or inactive.' };
    }
    var sheet = getSheet(SHEET_NAMES.ADS);
    var ads = sheetToObjects(sheet);
    var ad = ads.find(function (a) { return a.adId === params.adId; });
    if (!ad) return { success: false, message: 'Advertisement not found.' };
    if (ad.postedBy !== params.userId) return { success: false, message: 'Not authorized.' };
    if (ad.status === 'taken_down') {
      return { success: false, message: 'This advertisement was taken down by an admin and can only be restored by an admin.' };
    }
    updateRowById(sheet, HEADERS.Advertisements, 'adId', params.adId, {
      status: params.status,
      updatedAt: new Date().toISOString()
    });
    return { success: true };
  }
  
  function deleteAd(params) {
    if (!params.adId || !params.userId) return { success: false, message: 'adId and userId are required.' };
    var sheet = getSheet(SHEET_NAMES.ADS);
    var ads = sheetToObjects(sheet);
    var ad = ads.find(function (a) { return a.adId === params.adId; });
    if (!ad) return { success: false, message: 'Advertisement not found.' };
    if (ad.postedBy !== params.userId) return { success: false, message: 'Not authorized to delete this advertisement.' };
    deleteRowById(sheet, 'adId', params.adId);
  
    // best-effort cleanup of dependent rows
    try {
      var savedSheet = getSheet(SHEET_NAMES.SAVED);
      var savedData = savedSheet.getDataRange().getValues();
      var adIdx = savedData[0].indexOf('adId');
      for (var i = savedData.length - 1; i >= 1; i--) {
        if (savedData[i][adIdx] === params.adId) savedSheet.deleteRow(i + 1);
      }
    } catch (e) { /* non-fatal */ }
  
    // NOTE: sponsorship history rows for this ad are intentionally left
    // in place in the Sponsorships sheet (they're a payment record), but
    // since the ad no longer exists they'll simply never surface as
    // "sponsored" again on any ad list.
  
    return { success: true };
  }
  
  function getMyAds(params) {
    if (!params.userId) return { success: false, message: 'userId is required.' };
    var sheet = getSheet(SHEET_NAMES.ADS);
    var ads = sheetToObjects(sheet).filter(function (a) { return a.postedBy === params.userId; });
    ads.sort(function (a, b) { return new Date(b.postedAt) - new Date(a.postedAt); });
    var usersById = getUsersById();
    var sponsorshipMap = getActiveSponsorshipMap();
    return { success: true, ads: ads.map(function (a) { return normalizeAd(a, usersById, sponsorshipMap); }) };
  }
  
  // ============================================================
  // SAVED ADS
  // ============================================================
  function saveAd(params) {
    if (!params.userId || !params.adId) return { success: false, message: 'userId and adId are required.' };
    var sheet = getSheet(SHEET_NAMES.SAVED);
    var saved = sheetToObjects(sheet);
    var already = saved.some(function (s) { return s.userId === params.userId && s.adId === params.adId; });
    if (already) return { success: true, message: 'Already saved.' };
    appendRowObject(sheet, HEADERS.SavedAds, {
      id: Utilities.getUuid(), userId: params.userId, adId: params.adId,
      savedAt: new Date().toISOString()
    });
    return { success: true };
  }
  
  function removeSavedAd(params) {
    if (!params.userId || !params.adId) return { success: false, message: 'userId and adId are required.' };
    var sheet = getSheet(SHEET_NAMES.SAVED);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var userIdx = headers.indexOf('userId');
    var adIdx = headers.indexOf('adId');
    if (userIdx === -1 || adIdx === -1) return { success: false, message: 'Sheet headers are missing. Run setupSheets().' };
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][userIdx] === params.userId && data[i][adIdx] === params.adId) {
        sheet.deleteRow(i + 1);
      }
    }
    return { success: true };
  }
  
  function getSavedAds(params) {
    if (!params.userId) return { success: false, message: 'userId is required.' };
    var savedSheet = getSheet(SHEET_NAMES.SAVED);
    var adsSheet = getSheet(SHEET_NAMES.ADS);
    var saved = sheetToObjects(savedSheet).filter(function (s) { return s.userId === params.userId; });
    var allAds = sheetToObjects(adsSheet);
    var usersById = getUsersById();
    var sponsorshipMap = getActiveSponsorshipMap();
    var ads = saved.map(function (s) {
      var ad = allAds.find(function (a) { return a.adId === s.adId; });
      return ad ? Object.assign({}, normalizeAd(ad, usersById, sponsorshipMap), { savedAt: s.savedAt }) : null;
    }).filter(Boolean);
    ads.sort(function (a, b) { return new Date(b.savedAt) - new Date(a.savedAt); });
    return { success: true, ads: ads };
  }
  
  // ============================================================
  // REPORTS
  // ============================================================
  function submitReport(params) {
    var required = ['adId', 'userId', 'reason'];
    for (var i = 0; i < required.length; i++) {
      if (!params[required[i]]) return { success: false, message: 'Missing field: ' + required[i] };
    }
    var sheet = getSheet(SHEET_NAMES.REPORTS);
    var newReport = {
      reportId: Utilities.getUuid(),
      adId: params.adId,
      userId: params.userId,
      userName: params.userName || '',
      reason: params.reason,
      description: params.description || '',
      status: 'pending',
      reportedAt: new Date().toISOString(),
      reviewedBy: '',
      reviewedAt: '',
      reviewNote: ''
    };
    appendRowObject(sheet, HEADERS.Reports, newReport);
    return { success: true, report: newReport };
  }
  
  function getUserReports(params) {
    if (!params.userId) return { success: false, message: 'userId is required.' };
    var reportsSheet = getSheet(SHEET_NAMES.REPORTS);
    var adsSheet = getSheet(SHEET_NAMES.ADS);
    var reports = sheetToObjects(reportsSheet).filter(function (r) { return r.userId === params.userId; });
    var allAds = sheetToObjects(adsSheet);
    reports.forEach(function (r) {
      var ad = allAds.find(function (a) { return a.adId === r.adId; });
      r.adTitle = ad ? ad.jobTitle : '(advertisement removed)';
      r.adBusinessName = ad ? ad.businessName : '';
    });
    reports.sort(function (a, b) { return new Date(b.reportedAt) - new Date(a.reportedAt); });
    return { success: true, reports: reports };
  }
  
  // ============================================================
  // REVIEWS & RATINGS
  // ============================================================
  function submitReview(params) {
    var required = ['fromUserId', 'toUserId', 'toRole', 'rating'];
    for (var i = 0; i < required.length; i++) {
      if (!params[required[i]] && params[required[i]] !== 0) return { success: false, message: 'Missing field: ' + required[i] };
    }
    var rating = Number(params.rating);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      return { success: false, message: 'Rating must be between 1 and 5.' };
    }
    if (params.fromUserId === params.toUserId) {
      return { success: false, message: "You can't review yourself." };
    }
  
    var sheet = getSheet(SHEET_NAMES.REVIEWS);
    var newReview = {
      reviewId: Utilities.getUuid(),
      adId: params.adId || '',
      fromUserId: params.fromUserId,
      fromUserName: params.fromUserName || '',
      toUserId: params.toUserId,
      toRole: params.toRole, // 'business' | 'worker'
      rating: rating,
      comment: params.comment || '',
      createdAt: new Date().toISOString()
    };
    appendRowObject(sheet, HEADERS.Reviews, newReview);
  
    // recompute aggregate rating on the target user
    var allReviews = sheetToObjects(sheet).filter(function (r) { return r.toUserId === params.toUserId; });
    var sum = allReviews.reduce(function (s, r) { return s + (Number(r.rating) || 0); }, 0);
    var count = allReviews.length;
    var avg = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
  
    var usersSheet = getSheet(SHEET_NAMES.USERS);
    updateRowById(usersSheet, HEADERS.Users, 'userId', params.toUserId, {
      avgRating: avg,
      ratingCount: count
    });
  
    return { success: true, review: newReview, avgRating: avg, ratingCount: count };
  }
  
  function getUserReviews(params) {
    if (!params.toUserId) return { success: false, message: 'toUserId is required.' };
    var sheet = getSheet(SHEET_NAMES.REVIEWS);
    var reviews = sheetToObjects(sheet).filter(function (r) { return r.toUserId === params.toUserId; });
    reviews.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    return { success: true, reviews: reviews };
  }
  
  // ============================================================
  // SALARY BENCHMARKING
  // ============================================================
  function getSalaryBenchmark(params) {
    var ads = sheetToObjects(getSheet(SHEET_NAMES.ADS)).filter(function (a) { return a.status === 'active'; });
  
    if (params.category) {
      var cat = String(params.category).toLowerCase();
      var matching = ads.filter(function (a) {
        var displayCat = (a.workerCategory === 'Other' && a.customCategory) ? a.customCategory : a.workerCategory;
        return String(displayCat).toLowerCase() === cat;
      });
      var values = matching.map(function (a) { return parseSalaryNumber(a.salary); }).filter(function (v) { return v > 0; });
      if (values.length === 0) return { success: true, category: params.category, avgSalary: null, sampleSize: 0 };
      var total = values.reduce(function (s, v) { return s + v; }, 0);
      return {
        success: true,
        category: params.category,
        avgSalary: Math.round(total / values.length),
        minSalary: Math.min.apply(null, values),
        maxSalary: Math.max.apply(null, values),
        sampleSize: values.length
      };
    }
  
    // no category -> return per-category averages
    var byCategory = {};
    ads.forEach(function (a) {
      var displayCat = (a.workerCategory === 'Other' && a.customCategory) ? a.customCategory : a.workerCategory;
      var v = parseSalaryNumber(a.salary);
      if (!displayCat || v <= 0) return;
      if (!byCategory[displayCat]) byCategory[displayCat] = [];
      byCategory[displayCat].push(v);
    });
    var result = {};
    Object.keys(byCategory).forEach(function (cat) {
      var values = byCategory[cat];
      var total = values.reduce(function (s, v) { return s + v; }, 0);
      result[cat] = { avgSalary: Math.round(total / values.length), sampleSize: values.length };
    });
    return { success: true, benchmarks: result };
  }
  
  // ============================================================
  // ADMIN
  // ============================================================
  function requireAdmin(params) {
    if (!params.adminId) return false;
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var admin = users.find(function (u) { return u.userId === params.adminId; });
    return !!(admin && admin.role === 'admin');
  }
  
  function getAllAdsAdmin(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    var sheet = getSheet(SHEET_NAMES.ADS);
    var ads = sheetToObjects(sheet);
    ads.sort(function (a, b) { return new Date(b.postedAt) - new Date(a.postedAt); });
    var usersById = getUsersById();
    var sponsorshipMap = getActiveSponsorshipMap();
    return { success: true, ads: ads.map(function (a) { return normalizeAd(a, usersById, sponsorshipMap); }) };
  }
  
  function getAllUsersAdmin(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet).map(sanitizeUser);
    users.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    return { success: true, users: users };
  }
  
  function getAllReportsAdmin(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    var reportsSheet = getSheet(SHEET_NAMES.REPORTS);
    var adsSheet = getSheet(SHEET_NAMES.ADS);
    var reports = sheetToObjects(reportsSheet);
    var allAds = sheetToObjects(adsSheet);
    var usersById = getUsersById();
    var sponsorshipMap = getActiveSponsorshipMap();
    reports.forEach(function (r) {
      var ad = allAds.find(function (a) { return a.adId === r.adId; });
      r.ad = ad ? normalizeAd(ad, usersById, sponsorshipMap) : null;
    });
    reports.sort(function (a, b) { return new Date(b.reportedAt) - new Date(a.reportedAt); });
    return { success: true, reports: reports };
  }
  
  function reviewReport(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    if (!params.reportId || !params.decision) {
      return { success: false, message: 'reportId and decision are required.' };
    }
    var sheet = getSheet(SHEET_NAMES.REPORTS);
    var updates = {
      status: params.decision === 'takedown' ? 'actioned' : 'dismissed',
      reviewedBy: params.adminId,
      reviewedAt: new Date().toISOString(),
      reviewNote: params.reviewNote || ''
    };
    updateRowById(sheet, HEADERS.Reports, 'reportId', params.reportId, updates);
  
    if (params.decision === 'takedown' && params.adId) {
      takedownAd(params);
    }
    logAdminAction(params.adminId, 'reviewReport', params.reportId, params.decision);
    return { success: true };
  }
  
  function takedownAd(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    if (!params.adId) return { success: false, message: 'adId is required.' };
    var sheet = getSheet(SHEET_NAMES.ADS);
    var updates = {
      status: 'taken_down',
      takedownReason: params.takedownReason || params.reviewNote || 'Reported as misleading content.',
      takedownAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    var ok = updateRowById(sheet, HEADERS.Advertisements, 'adId', params.adId, updates);
    if (!ok) return { success: false, message: 'Advertisement not found.' };
    logAdminAction(params.adminId, 'takedownAd', params.adId, updates.takedownReason);
    return { success: true };
  }
  
  function restoreAd(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    if (!params.adId) return { success: false, message: 'adId is required.' };
    var sheet = getSheet(SHEET_NAMES.ADS);
    var ok = updateRowById(sheet, HEADERS.Advertisements, 'adId', params.adId, {
      status: 'active', takedownReason: '', takedownAt: '', updatedAt: new Date().toISOString()
    });
    if (!ok) return { success: false, message: 'Advertisement not found.' };
    logAdminAction(params.adminId, 'restoreAd', params.adId, '');
    return { success: true };
  }
  
  function verifyUser(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    if (!params.userId) return { success: false, message: 'userId is required.' };
    var verified = params.verified === true || params.verified === 'true';
    var sheet = getSheet(SHEET_NAMES.USERS);
    var ok = updateRowById(sheet, HEADERS.Users, 'userId', params.userId, { verified: verified });
    if (!ok) return { success: false, message: 'User not found.' };
    logAdminAction(params.adminId, verified ? 'verifyUser' : 'unverifyUser', params.userId, '');
    return { success: true };
  }
  
  // Admin can suspend a worker or business profile — hides them from
  // public "Workers near you" search and flags their profile page.
  function suspendUser(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    if (!params.userId) return { success: false, message: 'userId is required.' };
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var target = users.find(function (u) { return u.userId === params.userId; });
    if (!target) return { success: false, message: 'User not found.' };
    if (target.role === 'admin') return { success: false, message: "Admin accounts can't be suspended." };
  
    var ok = updateRowById(sheet, HEADERS.Users, 'userId', params.userId, {
      suspended: true,
      suspendReason: params.suspendReason || 'Profile suspended by admin.',
      suspendedAt: new Date().toISOString()
    });
    if (!ok) return { success: false, message: 'User not found.' };
    logAdminAction(params.adminId, 'suspendUser', params.userId, params.suspendReason || '');
    return { success: true };
  }
  
  function restoreUserProfile(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    if (!params.userId) return { success: false, message: 'userId is required.' };
    var sheet = getSheet(SHEET_NAMES.USERS);
    var ok = updateRowById(sheet, HEADERS.Users, 'userId', params.userId, {
      suspended: false, suspendReason: '', suspendedAt: ''
    });
    if (!ok) return { success: false, message: 'User not found.' };
    logAdminAction(params.adminId, 'restoreUserProfile', params.userId, '');
    return { success: true };
  }
  
  function logAdminAction(adminId, action, targetId, note) {
    try {
      var sheet = getSheet(SHEET_NAMES.ADMIN_LOGS);
      appendRowObject(sheet, HEADERS.AdminLogs, {
        logId: Utilities.getUuid(), adminId: adminId, action: action,
        targetId: targetId, note: note, timestamp: new Date().toISOString()
      });
    } catch (e) { /* non-fatal */ }
  }
  
  function getDashboardStats(params) {
    if (!requireAdmin(params)) return { success: false, message: 'Admin access required.' };
    var ads = sheetToObjects(getSheet(SHEET_NAMES.ADS));
    var users = sheetToObjects(getSheet(SHEET_NAMES.USERS));
    var reports = sheetToObjects(getSheet(SHEET_NAMES.REPORTS));
    var sponsorships = sheetToObjects(getSheet(SHEET_NAMES.SPONSORSHIPS));
  
    var activeAds = ads.filter(function (a) { return a.status === 'active'; }).length;
    var inactiveAds = ads.filter(function (a) { return a.status === 'inactive'; }).length;
    var takenDown = ads.filter(function (a) { return a.status === 'taken_down'; }).length;
    var urgentAds = ads.filter(function (a) { return a.status === 'active' && boolOf(a.urgent); }).length;
    var pendingReports = reports.filter(function (r) { return r.status === 'pending'; }).length;
    var totalWorkersRequested = ads
      .filter(function (a) { return a.status === 'active'; })
      .reduce(function (sum, a) { return sum + (Number(a.numWorkers) || 0); }, 0);
    var verifiedUsers = users.filter(function (u) { return boolOf(u.verified); }).length;
    var suspendedUsers = users.filter(function (u) { return boolOf(u.suspended); }).length;
  
    // How many worker-type profiles have actually set a location —
    // useful to gauge adoption of the location feature.
    var workerProfiles = users.filter(function (u) { return u.userType === 'worker' || u.userType === 'both'; });
    var workersWithLocation = workerProfiles.filter(function (u) {
      return u.locationLat !== '' && u.locationLat !== undefined && u.locationLat !== null;
    }).length;
  
    var categoryCounts = {};
    ads.forEach(function (a) {
      if (a.status !== 'active') return;
      var cat = (a.workerCategory === 'Other' && a.customCategory) ? a.customCategory : a.workerCategory;
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  
    // NEW (v5): sponsorship stats.
    var sponsorshipMap = getActiveSponsorshipMap();
    var activeSponsorships = Object.keys(sponsorshipMap).length;
    var totalSponsorshipRevenue = sponsorships.reduce(function (sum, s) {
      return sum + (Number(s.amount) || 0);
    }, 0);
  
    return {
      success: true,
      stats: {
        totalAds: ads.length,
        activeAds: activeAds,
        inactiveAds: inactiveAds,
        takenDownAds: takenDown,
        urgentAds: urgentAds,
        totalUsers: users.length,
        verifiedUsers: verifiedUsers,
        suspendedUsers: suspendedUsers,
        totalReports: reports.length,
        pendingReports: pendingReports,
        totalWorkersRequested: totalWorkersRequested,
        totalWorkerProfiles: workerProfiles.length,
        workersWithLocation: workersWithLocation,
        categoryCounts: categoryCounts,
        activeSponsorships: activeSponsorships,
        totalSponsorshipRevenue: totalSponsorshipRevenue
      }
    };
  }
  
  // ============================================================
  // ADMIN LOGIN DIAGNOSTICS / RECOVERY
  // Run these manually from the Apps Script editor (select the function
  // name in the dropdown next to "Run", click Run, then check View > Logs
  // or Executions for the output). Not exposed via the web app API.
  // ============================================================
  
  // Logs every row in Users with role === 'admin' on THIS spreadsheet.
  // Use this first if login says "No account found with this email" —
  // it tells you whether an admin row exists here at all, and under what
  // email, without needing to open the sheet and scroll through columns.
  function debugFindAdmin() {
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var admins = users.filter(function (u) { return u.role === 'admin'; });
  
    if (admins.length === 0) {
      Logger.log('No admin row found in Users. Run setupSheets() to create the default admin (admin@rojgararea.local / admin123).');
      return;
    }
  
    admins.forEach(function (a) {
      Logger.log('Admin found — userId: ' + a.userId + ', email: ' + a.email + ', createdAt: ' + a.createdAt);
    });
    Logger.log('Total admin accounts: ' + admins.length);
    Logger.log('If this email does not match what you are typing on the login page, that mismatch is why login fails — use the email logged above, or run resetAdminPassword() and log in with it.');
  }
  
  // Resets every admin account's password back to 'admin123'. Use this if
  // an admin row exists (per debugFindAdmin) but the password is unknown
  // or was changed. Safe to re-run.
  function resetAdminPassword() {
    var sheet = getSheet(SHEET_NAMES.USERS);
    var users = sheetToObjects(sheet);
    var admins = users.filter(function (u) { return u.role === 'admin'; });
  
    if (admins.length === 0) {
      Logger.log('No admin account exists yet — run setupSheets() first, it will create one.');
      return;
    }
  
    admins.forEach(function (a) {
      updateRowById(sheet, HEADERS.Users, 'userId', a.userId, { passwordHash: hashPassword('admin123') });
      Logger.log('Password reset to "admin123" for admin account: ' + a.email);
    });
  }
  
  // ============================================================
  // TEST FUNCTION - Run this to test your deployment
  // ============================================================
  function testAPI() {
    try {
      var url = 'YOUR_DEPLOYED_URL_HERE'; // Replace with your deployed URL
      var payload = {
        action: 'login',
        email: 'admin@rojgararea.local',
        password: 'admin123'
      };
  
      var options = {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify(payload)
      };
  
      var response = UrlFetchApp.fetch(url, options);
      Logger.log('Response: ' + response.getContentText());
    } catch (e) {
      Logger.log('Error: ' + e.message);
    }
  }