
    const firebaseConfig = {
  apiKey: "AIzaSyDz-YC3KRG1xTlTvzwkrm3c0ytSUN8NMPc",
  authDomain: "cinemastery-7aa1f.firebaseapp.com",
  projectId: "cinemastery-7aa1f",
  storageBucket: "cinemastery-7aa1f.firebasestorage.app",
  messagingSenderId: "971035287263",
  appId: "1:971035287263:web:60ceb865417128a42d936a"
};

    const ENABLE_FIREBASE_ONLINE = true;
    let db = null;
    let isCloudFirestoreOnline = false;

    try {
      if (typeof firebase !== 'undefined' && firebase.apps) {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        if (firebase.firestore) {
          firebase.firestore.setLogLevel('silent');
          db = firebase.firestore();
          if (!ENABLE_FIREBASE_ONLINE && typeof db.disableNetwork === 'function') {
            db.disableNetwork().catch(() => {});
          }
        }
      }
    } catch (err) {
      db = null;
    }

    function updateSyncIndicatorUI(isOnline) {
      const syncBadge = document.getElementById('cloud-sync-status');
      const syncLabel = document.getElementById('sync-label-text');
      if (!syncBadge || !syncLabel) return;
      if (isOnline) {
        syncBadge.className = 'hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] font-mono text-emerald-700 font-semibold shadow-xs';
        syncLabel.innerText = 'Cloud Sync Aktif ✓';
      } else {
        syncBadge.className = 'hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-xl text-[11px] font-mono text-slate-600 font-semibold shadow-xs';
        syncLabel.innerText = 'Penyimpanan Lokal Aktif ✓';
      }
    }

    async function saveProgressToCloud() {
      if (!ENABLE_FIREBASE_ONLINE || !isStudentLoggedIn() || isTeacherLoggedIn() || !db) return;
      try {
        await db.collection("users").doc(window.appState.userId).set({
          profile: window.appState.studentProfile,
          completedSteps: window.appState.completedSteps,
          completedMissions: window.appState.completedMissions,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (e) {}
    }

    const TEACHER_OFFICIAL_NAME = 'aditya alhamdy syahputra';
    const TEACHER_OFFICIAL_PASS = 'filmrolas321';

    let savedUid = localStorage.getItem('fobi_uid');
    if (!savedUid) {
      savedUid = 'dkv_user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      localStorage.setItem('fobi_uid', savedUid);
    }

    let localSavedSubmissions = [];
    try {
      localSavedSubmissions = JSON.parse(localStorage.getItem('fobi_gallery_submissions') || '[]');
    } catch(e) {
      localSavedSubmissions = [];
    }

    window.appState = {
      user: null,
      userId: savedUid,
      currentUserRole: localStorage.getItem('fobi_role') || 'guest',
      studentProfile: JSON.parse(localStorage.getItem('fobi_student') || 'null'),
      teacherProfile: JSON.parse(localStorage.getItem('fobi_teacher') || 'null'),
      completedSteps: JSON.parse(localStorage.getItem('fobi_steps') || '[]'),
      completedMissions: JSON.parse(localStorage.getItem('fobi_missions') || '[]'),
      gallerySubmissions: localSavedSubmissions,
      audioEnabled: true
    };

    let galleryItems = [];
    let galleryUsingFallback = false;
    let galleryCursor = null;
    let galleryHasMore = true;
    let galleryLoading = false;
    let galleryReady = false;
    let galleryPagesLoaded = false;
    let galleryError = '';
    let teacherGalleryComplete = false;
    let teacherGalleryRequest = null;
    let latestGalleryIds = new Set();

    function cacheGallery() {
      try {
        localStorage.setItem('fobi_gallery_submissions', JSON.stringify(window.appState.gallerySubmissions));
      } catch (error) {
        console.warn('Cache galeri tidak dapat disimpan:', error);
      }
    }

    function mergeGalleryDocuments(docs) {
      const entries = new Map(galleryItems.map(item => [item.id, item]));
      docs.forEach(doc => entries.set(doc.id, { ...doc.data(), id: doc.id }));
      galleryItems = [...entries.values()].sort((a, b) =>
        String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || b.id.localeCompare(a.id));
      const allEntries = new Map(window.appState.gallerySubmissions.map(item => [item.id, item]));
      galleryItems.forEach(item => allEntries.set(item.id, item));
      window.appState.gallerySubmissions = [...allEntries.values()];
      cacheGallery();
    }

    function renderGallerySkeletons() {
      const container = document.getElementById('gallery-skeletons');
      const loading = (!galleryReady && !galleryUsingFallback) || galleryLoading;
      document.getElementById('gallery-grid')?.setAttribute('aria-busy', String(loading));
      if (!container) return;
      container.hidden = !loading;
      container.innerHTML = loading ? Array.from({ length: 12 }, () => `
        <div class="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-canva-card animate-pulse" aria-hidden="true">
          <div class="aspect-video bg-slate-200"></div>
          <div class="p-4 space-y-3"><div class="h-3 w-1/3 bg-slate-200 rounded"></div>
            <div class="h-4 w-3/4 bg-slate-200 rounded"></div>
            <div class="pt-2 border-t border-slate-100 flex justify-between"><div class="h-3 w-1/2 bg-slate-200 rounded"></div><div class="h-3 w-1/4 bg-slate-200 rounded"></div></div>
          </div>
        </div>`).join('') : '';
    }

    function finishGalleryImage(image, failed = false) {
      const placeholder = image.parentElement.querySelector('[data-image-placeholder]');
      if (placeholder) {
        placeholder.classList.remove('animate-pulse');
        if (failed) {
          placeholder.textContent = 'Foto tidak dapat dimuat';
          placeholder.classList.add('flex', 'items-center', 'justify-center', 'text-xs', 'text-slate-500');
        } else placeholder.hidden = true;
      }
      image.classList.toggle('opacity-0', failed);
    }

    function updateGalleryPagingUI() {
      renderGallerySkeletons();
      const button = document.getElementById('gallery-load-more');
      const status = document.getElementById('gallery-load-status');
      if (button) {
        button.hidden = !galleryReady || !galleryHasMore || galleryUsingFallback || !ENABLE_FIREBASE_ONLINE || !db;
        button.disabled = galleryLoading || !galleryReady;
        button.textContent = galleryLoading ? 'Memuat...' : 'Muat Lebih Banyak';
      }
      if (status) status.textContent = galleryError ||
        (galleryHasMore
          ? 'Filter dan jumlah karya berlaku untuk foto yang sudah dimuat. Muat lebih banyak untuk melihat karya lainnya.'
          : 'Semua karya yang tersedia sudah dimuat.');
      const teacherStatus = document.getElementById('teacher-data-status');
      if (teacherStatus) teacherStatus.textContent = teacherGalleryComplete ? '' :
        (teacherGalleryRequest ? 'Memuat seluruh tugas untuk dashboard dan ekspor...' :
          'Data dashboard belum lengkap. Buka kembali Dashboard Guru untuk mencoba memuat seluruh tugas.');
    }

    async function loadMoreGallery() {
      if (galleryLoading || !galleryReady || !galleryCursor || !galleryHasMore || galleryUsingFallback || !db) return;
      galleryLoading = true;
      galleryError = '';
      updateGalleryPagingUI();
      try {
        const snapshot = await db.collection('gallery').orderBy('timestamp', 'desc')
          .startAfter(galleryCursor).limit(12).get({ source: 'server' });
        mergeGalleryDocuments(snapshot.docs);
        galleryPagesLoaded = true;
        if (snapshot.docs.length) galleryCursor = snapshot.docs[snapshot.docs.length - 1];
        galleryHasMore = snapshot.docs.length === 12;
      } catch (error) {
        galleryError = 'Gagal memuat foto berikutnya. Klik Muat Lebih Banyak untuk mencoba lagi.';
      } finally {
        galleryLoading = false;
        renderRealStudentGallery(window.currentGalleryFilter || 'all');
      }
    }

    async function ensureTeacherGallery() {
      if (!isTeacherLoggedIn()) return false;
      if (teacherGalleryComplete) return true;
      if (teacherGalleryRequest) return teacherGalleryRequest;
      if (!ENABLE_FIREBASE_ONLINE || !db) {
        alertBox('Cloud tidak tersedia. Dashboard memakai cache yang mungkin belum lengkap; ekspor lengkap belum tersedia.');
        return false;
      }
      teacherGalleryRequest = (async () => {
        try {
          const snapshot = await db.collection('gallery').orderBy('timestamp', 'desc').get({ source: 'server' });
          // The full teacher result is authoritative, including older tasks.
          window.appState.gallerySubmissions = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
          teacherGalleryComplete = true;
          cacheGallery();
          renderTeacherTable();
          renderRealStudentGallery(window.currentGalleryFilter || 'all');
          return true;
        } catch (error) {
          alertBox('Seluruh tugas belum berhasil dimuat. Data cache mungkin belum lengkap; coba buka Dashboard Guru kembali.');
          return false;
        } finally {
          teacherGalleryRequest = null;
          updateGalleryPagingUI();
        }
      })();
      updateGalleryPagingUI();
      return teacherGalleryRequest;
    }

    if (ENABLE_FIREBASE_ONLINE && db) {
      db.collection('gallery').orderBy('timestamp', 'desc').limit(12).onSnapshot(snapshot => {
        const docs = snapshot.docs;
        const currentIds = new Set(docs.map(doc => doc.id));
        const boundary = docs.length ? String(docs[docs.length - 1].data().timestamp || '') : '';
        // Keep entries displaced below the live window; remove deletions inside it.
        galleryItems = galleryItems.filter(item =>
          !latestGalleryIds.has(item.id) || currentIds.has(item.id) ||
          (docs.length === 12 && String(item.timestamp || '') <= boundary));
        latestGalleryIds = currentIds;
        if (!galleryPagesLoaded && !galleryLoading || galleryUsingFallback) galleryItems = [];
        galleryUsingFallback = false;
        mergeGalleryDocuments(docs);
        if (!galleryPagesLoaded && !galleryLoading) {
          galleryCursor = docs.length ? docs[docs.length - 1] : null;
          galleryHasMore = docs.length === 12;
        }
        galleryReady = true;
        galleryError = '';
        renderRealStudentGallery(window.currentGalleryFilter || 'all');
        if (isTeacherLoggedIn()) renderTeacherTable();
      }, () => {
        galleryError = 'Cloud galeri tidak tersedia. Menampilkan cache lokal; data dan filter mungkin belum lengkap. Muat ulang untuk mencoba koneksi kembali.';
        galleryUsingFallback = true;
        if (!galleryReady) galleryItems = [...new Map(localSavedSubmissions.map(item => [item.id, item])).values()].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 12);
        renderRealStudentGallery(window.currentGalleryFilter || 'all');
      });
    } else {
      galleryUsingFallback = true;
      galleryItems = localSavedSubmissions.slice(0, 12);
      galleryError = 'Menampilkan cache lokal; data dan filter mungkin belum lengkap.';
    }

    function escapeHtml(string) {
      if (!string) return '';
      return String(string).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    let audioCtx = null;
    function playDialClick() {
      if (!window.appState?.audioEnabled) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.02);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.025);
      } catch (e) {}
    }

    function playAfBeepSound() {
      if (!window.appState?.audioEnabled) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.11);
      } catch (e) {}
    }

    function playShutterSound() {
      if (!window.appState?.audioEnabled) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(750, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.06);
      } catch (e) {}
    }

    function toggleAudioFx() {
      window.appState.audioEnabled = !window.appState.audioEnabled;
      const icon = document.getElementById('audio-icon');
      if (window.appState.audioEnabled) {
        if (icon) icon.className = 'fa-solid fa-volume-high text-xs text-purple-600';
        playShutterSound();
      } else {
        if (icon) icon.className = 'fa-solid fa-volume-xmark text-xs text-slate-400';
      }
    }

    function isStudentLoggedIn() {
      return (window.appState?.currentUserRole === 'student' && Boolean(window.appState?.studentProfile?.name)) ||
             window.appState?.currentUserRole === 'teacher';
    }

    function isTeacherLoggedIn() {
      return window.appState?.currentUserRole === 'teacher';
    }

    function switchMainTab(targetTabId, subModulId = null) {
      if (targetTabId === 'tab-guru') {
        if (!isTeacherLoggedIn()) {
          openLoginModal('teacher');
          alertBox('🔒 Akses Khusus: Silakan login sebagai Guru (aditya alhamdy syahputra).');
          return;
        }
      } else if (targetTabId !== 'tab-beranda' && targetTabId !== 'tab-tutorial' && !isStudentLoggedIn()) {
        openLoginModal('student');
        alertBox('🔒 Modul Terkunci: Silakan masukkan identitas siswa terlebih dahulu.');
        return;
      }
      playDialClick();
      document.querySelectorAll('.view-content-panel').forEach(panel => panel.classList.remove('active-view'));
      const activePanel = document.getElementById(targetTabId);
      if (activePanel) activePanel.classList.add('active-view');
      const tabMap = {
        'tab-beranda': 'nav-tab-beranda',
        'tab-tutorial': 'nav-tab-tutorial',
        'tab-materi': 'nav-tab-materi',
        'tab-tugas': 'nav-tab-tugas',
        'tab-evaluasi': 'nav-tab-evaluasi',
        'tab-refleksi': 'nav-tab-refleksi',
        'tab-guru': 'nav-tab-guru'
      };
      Object.keys(tabMap).forEach(k => {
        const btn = document.getElementById(tabMap[k]);
        if (btn) {
          if (k === targetTabId) {
            btn.className = 'w-full text-left px-4 py-3.5 rounded-xl flex items-center ' + (k === 'tab-tugas' ? 'justify-between' : 'gap-3') + ' transition-all canva-gradient-bg text-white shadow-md shadow-purple-500/20 font-bold';
          } else {
            btn.className = 'w-full text-left px-4 py-3.5 rounded-xl flex items-center ' + (k === 'tab-tugas' ? 'justify-between' : 'gap-3') + ' transition-all text-slate-600 hover:text-slate-900 hover:bg-slate-100';
          }
        }
      });
      closeSidebar(); // Menutup sidebar samping otomatis saat diklik
      
      if (targetTabId === 'tab-guru') {
        renderTeacherTable();
        ensureTeacherGallery();
      }
      if (subModulId) switchSubModul(subModulId);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function switchSubModul(targetSubId) {
      if (!isStudentLoggedIn()) {
        openLoginModal('student');
        alertBox('🔒 Silakan lengkapi identitas siswa untuk mengakses materi.');
        return;
      }
      playDialClick();
      document.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active-subtab'));
      const sub = document.getElementById(targetSubId);
      if (sub) sub.classList.add('active-subtab');
      const pillMap = {
        'sub-modul-1': 'pill-modul-1',
        'sub-modul-2': 'pill-modul-2',
        'sub-modul-3': 'pill-modul-3',
        'sub-modul-4': 'pill-modul-4',
        'sub-modul-5': 'pill-modul-5',
        'sub-modul-6': 'pill-modul-6'
      };
      Object.keys(pillMap).forEach(s => {
        const pill = document.getElementById(pillMap[s]);
        if (pill) {
          if (s === targetSubId) {
            pill.className = 'sub-modul-pill px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all canva-gradient-bg text-white shadow-md shadow-purple-500/20';
          } else {
            pill.className = 'sub-modul-pill px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all text-slate-600 hover:bg-slate-100';
          }
        }
      });
    }

    function openLoginModal(defaultRole = 'student') {
      switchLoginRole(defaultRole);
      const profile = window.appState?.studentProfile;
      const inputName = document.getElementById('login-input-name');
      const inputClass = document.getElementById('login-input-class');
      const inputNis = document.getElementById('login-input-nis');
      const btnLogoutStudent = document.getElementById('btn-logout-student');
      const btnLogoutTeacher = document.getElementById('btn-logout-teacher');
      
      if (profile && defaultRole === 'student') {
        if (inputName) inputName.value = profile.name || '';
        if (inputClass) inputClass.value = profile.studentClass || 'X FILM 1';
        if (inputNis) inputNis.value = profile.nis || '';
        if (btnLogoutStudent) btnLogoutStudent.classList.remove('hidden');
      } else {
        if (btnLogoutStudent) btnLogoutStudent.classList.add('hidden');
      }
      
      if (window.appState?.currentUserRole === 'teacher') {
        if (btnLogoutTeacher) btnLogoutTeacher.classList.remove('hidden');
      } else {
        if (btnLogoutTeacher) btnLogoutTeacher.classList.add('hidden');
      }
      
      const modal = document.getElementById('modal-login');
      if (modal) modal.classList.remove('hidden');
    }

    function closeLoginModal() {
      const modal = document.getElementById('modal-login');
      if (modal) modal.classList.add('hidden');
    }

    function switchLoginRole(role) {
      const tabStudent = document.getElementById('tab-login-student');
      const tabTeacher = document.getElementById('tab-login-teacher');
      const panelStudent = document.getElementById('panel-login-student');
      const panelTeacher = document.getElementById('panel-login-teacher');
      const errAlert = document.getElementById('teacher-error-alert');
      
      if (errAlert) errAlert.classList.add('hidden');
      
      if (role === 'teacher') {
        if (tabTeacher) tabTeacher.className = 'flex-1 py-2 text-xs font-mono font-bold rounded-xl transition-all canva-gradient-bg text-white flex items-center justify-center gap-1.5 shadow-sm';
        if (tabStudent) tabStudent.className = 'flex-1 py-2 text-xs font-mono font-bold rounded-xl transition-all text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5';
        if (panelStudent) panelStudent.classList.add('hidden');
        if (panelTeacher) panelTeacher.classList.remove('hidden');
      } else {
        if (tabStudent) tabStudent.className = 'flex-1 py-2 text-xs font-mono font-bold rounded-xl transition-all canva-gradient-bg text-white flex items-center justify-center gap-1.5 shadow-sm';
        if (tabTeacher) tabTeacher.className = 'flex-1 py-2 text-xs font-mono font-bold rounded-xl transition-all text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5';
        if (panelTeacher) panelTeacher.classList.add('hidden');
        if (panelStudent) panelStudent.classList.remove('hidden');
      }
    }

    function handleLoginSubmit(event) {
      event.preventDefault();
      const name = document.getElementById('login-input-name').value.trim();
      const studentClass = document.getElementById('login-input-class').value;
      const nis = document.getElementById('login-input-nis').value.trim();
      if (!name) return;
      
      const profile = { name, studentClass, nis };
      window.appState.studentProfile = profile;
      window.appState.currentUserRole = 'student';
      window.appState.teacherProfile = null;
      
      localStorage.setItem('fobi_student', JSON.stringify(profile));
      localStorage.setItem('fobi_role', 'student');
      localStorage.removeItem('fobi_teacher');
      
      renderStudentIdentityUI();
      closeLoginModal();
      playAfBeepSound();
      alertBox(`Selamat datang, ${name}! Identitas siswa aktif, seluruh modul dan tugas terbuka.`);
    }

    function handleTeacherLoginSubmit(event) {
      event.preventDefault();
      const inputName = document.getElementById('teacher-login-name').value.trim().toLowerCase();
      const inputPass = document.getElementById('teacher-login-pass').value.trim();
      const errAlert = document.getElementById('teacher-error-alert');
      const errText = document.getElementById('teacher-error-text');
      
      if (inputName === TEACHER_OFFICIAL_NAME && inputPass === TEACHER_OFFICIAL_PASS) {
        const teacherProfile = {
          name: 'aditya alhamdy syahputra',
          role: 'Guru Pengajar FILM',
          nip: 'SMKN 12 Surabaya'
        };
        window.appState.currentUserRole = 'teacher';
        window.appState.teacherProfile = teacherProfile;
        localStorage.setItem('fobi_role', 'teacher');
        localStorage.setItem('fobi_teacher', JSON.stringify(teacherProfile));
        
        if (errAlert) errAlert.classList.add('hidden');
        
        closeLoginModal();
        playAfBeepSound();
        const tabGuruBtn = document.getElementById('nav-tab-guru');
        if (tabGuruBtn) tabGuruBtn.classList.remove('hidden');
        
        renderStudentIdentityUI();
        switchMainTab('tab-guru');
        renderTeacherTable();
        alertBox(`Akses Diterima! Selamat datang, Bapak aditya alhamdy syahputra.`);
      } else {
        playDialClick();
        if (errAlert && errText) {
          errAlert.classList.remove('hidden');
          if (inputName !== TEACHER_OFFICIAL_NAME) {
            errText.innerText = `Nama Pengajar "${inputName}" tidak terdaftar! Nama harus: aditya alhamdy syahputra`;
          } else {
            errText.innerText = `Kata sandi guru salah! Silakan masukkan sandi yang tepat (1234).`;
          }
        }
      }
    }

    function logoutCurrentUser() {
      const prevRole = window.appState.currentUserRole;
      window.appState.currentUserRole = 'guest';
      window.appState.studentProfile = null;
      window.appState.teacherProfile = null;
      localStorage.removeItem('fobi_role');
      localStorage.removeItem('fobi_student');
      localStorage.removeItem('fobi_teacher');
      
      const tabGuruBtn = document.getElementById('nav-tab-guru');
      if (tabGuruBtn) tabGuruBtn.classList.add('hidden');
      
      renderStudentIdentityUI();
      closeLoginModal();
      switchMainTab('tab-beranda');
      alertBox(prevRole === 'teacher' ? 'Anda telah keluar dari Mode Guru.' : 'Anda telah keluar dari akun siswa.');
    }

    function renderStudentIdentityUI() {
      const role = window.appState?.currentUserRole;
      const studentProfile = window.appState?.studentProfile;
      const teacherProfile = window.appState?.teacherProfile;
      
      const dispName = document.getElementById('user-display-name');
      const dispClass = document.getElementById('user-display-class');
      const userIcon = document.getElementById('user-header-icon');
      const heroName = document.getElementById('hero-user-name');
      const gateBanner = document.getElementById('gate-warning-banner');
      
      const btnGuruLabel = document.getElementById('btn-guru-label');
      const tabGuruBtn = document.getElementById('nav-tab-guru');
      
      const iconMateri = document.getElementById('nav-icon-materi');
      const iconTugas = document.getElementById('nav-icon-tugas');
      const iconEvaluasi = document.getElementById('nav-icon-evaluasi');
      const iconRefleksi = document.getElementById('nav-icon-refleksi');
      
      if (role === 'teacher' && teacherProfile) {
        if (dispName) dispName.innerText = 'aditya alhamdy syahputra';
        if (dispClass) dispClass.innerText = '';
        if (btnGuruLabel) btnGuruLabel.innerText = 'Mode Guru (Aktif)';
        if (userIcon) userIcon.className = 'fa-solid fa-chalkboard-user text-[10px]';
        if (heroName) heroName.innerText = 'Bpk. aditya alhamdy syahputra (Guru)';
        if (gateBanner) gateBanner.classList.add('hidden');
        if (tabGuruBtn) tabGuruBtn.classList.remove('hidden');
        
        if (iconMateri) iconMateri.className = 'fa-solid fa-layer-group text-xs text-purple-600';
        if (iconTugas) iconTugas.className = 'fa-solid fa-list-check text-xs text-cyan-600';
        if (iconEvaluasi) iconEvaluasi.className = 'fa-solid fa-square-check text-xs text-emerald-600';
        if (iconRefleksi) iconRefleksi.className = 'fa-solid fa-clipboard-question text-xs text-purple-600';
      } else if (role === 'student' && studentProfile && studentProfile.name) {
        if (dispName) dispName.innerText = studentProfile.name;
        if (dispClass) dispClass.innerText = `${studentProfile.studentClass}${studentProfile.nis ? ' • Absen ' + studentProfile.nis : ''}`;
        if (btnGuruLabel) btnGuruLabel.innerText = 'Login Guru';
        if (userIcon) userIcon.className = 'fa-solid fa-user-graduate text-[10px]';
        if (heroName) heroName.innerText = `${studentProfile.name} (${studentProfile.studentClass})`;
        if (gateBanner) gateBanner.classList.add('hidden');
        if (tabGuruBtn) tabGuruBtn.classList.add('hidden');
        
        if (iconMateri) iconMateri.className = 'fa-solid fa-layer-group text-xs text-purple-600';
        if (iconTugas) iconTugas.className = 'fa-solid fa-list-check text-xs text-cyan-600';
        if (iconEvaluasi) iconEvaluasi.className = 'fa-solid fa-square-check text-xs text-emerald-600';
        if (iconRefleksi) iconRefleksi.className = 'fa-solid fa-clipboard-question text-xs text-purple-600';
      } else {
        if (dispName) dispName.innerText = 'Belum Masuk';
        if (dispClass) dispClass.innerText = 'Klik untuk Login';
        if (btnGuruLabel) btnGuruLabel.innerText = 'Login Guru';
        if (userIcon) userIcon.className = 'fa-solid fa-user text-[10px]';
        if (heroName) heroName.innerText = 'Belum Masuk (Terkunci)';
        if (gateBanner) gateBanner.classList.remove('hidden');
        if (tabGuruBtn) tabGuruBtn.classList.add('hidden');
        
        if (iconMateri) iconMateri.className = 'fa-solid fa-lock text-xs text-amber-500';
        if (iconTugas) iconTugas.className = 'fa-solid fa-lock text-xs text-amber-500';
        if (iconEvaluasi) iconEvaluasi.className = 'fa-solid fa-lock text-xs text-amber-500';
        if (iconRefleksi) iconRefleksi.className = 'fa-solid fa-lock text-xs text-amber-500';
      }
    }

    window.updateGlobalProgress = function() {
      const steps = window.appState?.completedSteps || [];
      const missions = window.appState?.completedMissions || [];
      const stepPct = (steps.length / 8) * 50;
      const missionPct = (missions.length / 7) * 50;
      const totalPct = Math.round(stepPct + missionPct);
      const progText = document.getElementById('header-progress-text');
      const progBar = document.getElementById('header-progress-bar');
      const heroLabel = document.getElementById('hero-progress-label');
      const missionText = document.getElementById('mission-counter-text');
      const endStatus = document.getElementById('end-mission-status');
      const navBadgeMission = document.getElementById('nav-badge-mission');
      
      if (progText) progText.innerText = `${totalPct}%`;
      if (progBar) progBar.style.width = `${totalPct}%`;
      if (heroLabel) heroLabel.innerText = `${missions.length}/7 Selesai`;
      if (missionText) missionText.innerText = `${missions.length} / 7 Selesai`;
      if (endStatus) endStatus.innerText = `${missions.length} / 7 Misi Selesai`;
      if (navBadgeMission) navBadgeMission.innerText = `${missions.length}/7`;
      
      for (let i = 1; i <= 8; i++) {
        const badge = document.getElementById(`badge-step-${i}`);
        const card = document.getElementById(`roadmap-card-${i}`);
        const isDone = steps.includes(i);
        if (badge) {
          badge.innerHTML = isDone ? '✓ Selesai' : '○ Belum';
          badge.className = isDone ? 'text-emerald-600 font-bold' : 'text-slate-400';
        }
        if (card) {
          if (isDone) {
            card.classList.add('border-emerald-300', 'bg-emerald-50/50');
          } else {
            card.classList.remove('border-emerald-300', 'bg-emerald-50/50');
          }
        }
      }
      
      for (let m = 1; m <= 7; m++) {
        const mStatus = document.getElementById(`mission-status-${m}`);
        const mBtn = document.getElementById(`btn-mission-${m}`);
        const mCard = document.getElementById(`mission-card-${m}`);
        const isDone = missions.includes(m);
        if (mStatus) {
          mStatus.innerText = isDone ? 'Selesai ✓' : 'Belum Selesai';
          mStatus.className = isDone ? 'text-[10px] font-mono text-emerald-600 font-bold' : 'text-[10px] font-mono text-slate-400';
        }
        if (mBtn) {
          mBtn.innerText = isDone ? 'Batal' : 'Tandai Selesai ✓';
          mBtn.className = isDone ? 'px-3 py-1.5 bg-slate-100 text-slate-600 font-bold text-xs font-mono rounded-xl shrink-0 border border-slate-200' : 'px-3.5 py-1.5 canva-gradient-bg text-white font-bold text-xs font-mono rounded-xl shrink-0 shadow-sm';
        }
        if (mCard) {
          if (isDone) {
            mCard.classList.add('border-emerald-300', 'bg-emerald-50/40');
          } else {
            mCard.classList.remove('border-emerald-300', 'bg-emerald-50/40');
          }
        }
      }
    };

    function markStepComplete(stepNum) {
      if (!isStudentLoggedIn()) {
        openLoginModal('student');
        alertBox('🔒 Silakan isi identitas siswa terlebih dahulu.');
        return;
      }
      if (!window.appState.completedSteps.includes(stepNum)) {
        window.appState.completedSteps.push(stepNum);
        localStorage.setItem('fobi_steps', JSON.stringify(window.appState.completedSteps));
        playDialClick();
        window.updateGlobalProgress();
        saveProgressToCloud();
      }
    }

    function toggleMission(missionNum) {
      if (!isStudentLoggedIn()) {
        openLoginModal('student');
        alertBox('🔒 Silakan isi identitas siswa sebelum menandai misi.');
        return;
      }
      const idx = window.appState.completedMissions.indexOf(missionNum);
      if (idx > -1) {
        window.appState.completedMissions.splice(idx, 1);
      } else {
        window.appState.completedMissions.push(missionNum);
      }
      localStorage.setItem('fobi_missions', JSON.stringify(window.appState.completedMissions));
      playShutterSound();
      window.updateGlobalProgress();
      saveProgressToCloud();
    }

    function resetAllProgress() {
      if (!isStudentLoggedIn()) {
        openLoginModal('student');
        return;
      }
      window.appState.completedSteps = [];
      window.appState.completedMissions = [];
      localStorage.setItem('fobi_steps', JSON.stringify([]));
      localStorage.setItem('fobi_missions', JSON.stringify([]));
      window.updateGlobalProgress();
      saveProgressToCloud();
      alertBox('Progres belajar telah di-reset.');
    }

    function triggerHeroShutter() {
      playShutterSound();
      const scene = document.getElementById('viewfinder-scene');
      const box = document.getElementById('hud-focus-box');
      if (scene) {
        scene.classList.add('brightness-200');
        setTimeout(() => scene.classList.remove('brightness-200'), 150);
      }
      if (box) {
        box.classList.add('border-emerald-400', 'scale-110');
        setTimeout(() => box.classList.remove('border-emerald-400', 'scale-110'), 400);
      }
    }

    function toggleHeroGrid() {
      const grid = document.getElementById('hero-grid-overlay');
      if (grid) grid.classList.toggle('opacity-0');
    }

    const APERTURE_STOPS = [
      { val: 'f/1.4', blur: 14, evContrib: 3 },
      { val: 'f/2.8', blur: 9, evContrib: 2 },
      { val: 'f/4.0', blur: 6, evContrib: 1 },
      { val: 'f/5.6', blur: 3, evContrib: 0 },
      { val: 'f/8.0', blur: 1.5, evContrib: -1 },
      { val: 'f/11', blur: 0.5, evContrib: -2 },
      { val: 'f/22', blur: 0, evContrib: -4 }
    ];
    const SHUTTER_STOPS = [
      { val: '2s (Bulb)', motionBlur: 20, evContrib: 4 },
      { val: '1/4s', motionBlur: 14, evContrib: 3 },
      { val: '1/15s', motionBlur: 9, evContrib: 2 },
      { val: '1/30s (Panning)', motionBlur: 6, evContrib: 1 },
      { val: '1/250s', motionBlur: 0, evContrib: 0 },
      { val: '1/500s', motionBlur: 0, evContrib: -1 },
      { val: '1/1000s', motionBlur: 0, evContrib: -2 },
      { val: '1/2000s (Freezing)', motionBlur: 0, evContrib: -3 }
    ];
    const ISO_STOPS = [
      { val: 'ISO 100', noise: 0, evContrib: -1 },
      { val: 'ISO 200', noise: 0.03, evContrib: 0 },
      { val: 'ISO 400', noise: 0.1, evContrib: 1 },
      { val: 'ISO 800', noise: 0.25, evContrib: 2 },
      { val: 'ISO 1600', noise: 0.45, evContrib: 3 },
      { val: 'ISO 6400', noise: 0.8, evContrib: 5 }
    ];
    const cameraSim = { apertureIdx: 1, shutterIdx: 4, isoIdx: 1, focusPlane: 1 };

    function updateCameraSimulator() {
      const aperture = APERTURE_STOPS[cameraSim.apertureIdx];
      const shutter = SHUTTER_STOPS[cameraSim.shutterIdx];
      const iso = ISO_STOPS[cameraSim.isoIdx];
      const hudShutter = document.getElementById('sim-hud-shutter');
      const hudAperture = document.getElementById('sim-hud-aperture');
      const hudIso = document.getElementById('sim-hud-iso');
      const lblAperture = document.getElementById('slider-aperture-label');
      const lblShutter = document.getElementById('slider-shutter-label');
      const lblIso = document.getElementById('slider-iso-label');
      
      if (hudShutter) hudShutter.innerText = shutter.val;
      if (hudAperture) hudAperture.innerText = aperture.val;
      if (hudIso) hudIso.innerText = iso.val;
      if (lblAperture) lblAperture.innerText = aperture.val;
      if (lblShutter) lblShutter.innerText = shutter.val;
      if (lblIso) lblIso.innerText = iso.val;
      
      const totalExposure = aperture.evContrib + shutter.evContrib + iso.evContrib;
      const netEv = (totalExposure - 2) * 0.5;
      const meterPin = document.getElementById('sim-meter-pin');
      const evLabel = document.getElementById('sim-ev-val');
      
      if (meterPin && evLabel) {
        const clampedEv = Math.max(-2, Math.min(2, netEv));
        const pinTopPercent = 50 - (clampedEv * 20);
        meterPin.style.top = `${pinTopPercent}%`;
        if (Math.abs(clampedEv) < 0.3) {
          evLabel.innerText = '0.0 EV';
          evLabel.className = 'font-bold text-emerald-400';
        } else if (clampedEv > 0) {
          evLabel.innerText = `+${clampedEv.toFixed(1)} EV`;
          evLabel.className = 'font-bold text-red-400';
        } else {
          evLabel.innerText = `${clampedEv.toFixed(1)} EV`;
          evLabel.className = 'font-bold text-blue-400';
        }
      }
      
      const dimmer = document.getElementById('sim-exposure-dimmer');
      if (dimmer) {
        if (netEv > 0.3) {
          dimmer.style.backgroundColor = `rgba(255, 255, 255, ${Math.min(0.8, (netEv - 0.3) * 0.4)})`;
        } else if (netEv < -0.3) {
          dimmer.style.backgroundColor = `rgba(0, 0, 0, ${Math.min(0.9, (Math.abs(netEv) - 0.3) * 0.4)})`;
        } else {
          dimmer.style.backgroundColor = 'transparent';
        }
      }
      
      const bgLayer = document.getElementById('sim-bg-layer');
      const subjectCard = document.getElementById('sim-subject-card');
      const subjectStatus = document.getElementById('sim-subject-status');
      
      if (bgLayer && subjectCard) {
        if (cameraSim.focusPlane === 1) {
          subjectCard.style.filter = 'blur(0px)';
          bgLayer.style.filter = `blur(${aperture.blur}px)`;
          if (subjectStatus) {
            subjectStatus.innerText = aperture.blur > 4 ? 'SUBJEK: TAJAM (BOKEH)' : 'SUBJEK & LATAR TAJAM';
            subjectStatus.className = 'text-[10px] font-mono font-bold text-emerald-400 px-2 py-0.5 rounded bg-black/70';
          }
        } else if (cameraSim.focusPlane === 0) {
          subjectCard.style.filter = 'blur(3px)';
          bgLayer.style.filter = `blur(${aperture.blur + 5}px)`;
          if (subjectStatus) {
            subjectStatus.innerText = 'FOKUS DEPAN';
            subjectStatus.className = 'text-[10px] font-mono font-bold text-amber-400 px-2 py-0.5 rounded bg-black/70';
          }
        } else if (cameraSim.focusPlane === 2) {
          subjectCard.style.filter = 'blur(8px)';
          bgLayer.style.filter = 'blur(0px)';
          if (subjectStatus) {
            subjectStatus.innerText = 'FOKUS LATAR';
            subjectStatus.className = 'text-[10px] font-mono font-bold text-blue-400 px-2 py-0.5 rounded bg-black/70';
          }
        }
      }
      
      const motionGhost = document.getElementById('sim-motion-ghost');
      const subjectIcon = document.getElementById('sim-subject-icon');
      if (motionGhost && subjectIcon) {
        if (shutter.motionBlur > 0) {
          motionGhost.style.opacity = Math.min(1, shutter.motionBlur / 14);
          subjectIcon.style.filter = `blur(${shutter.motionBlur * 0.25}px)`;
        } else {
          motionGhost.style.opacity = '0';
          subjectIcon.style.filter = 'none';
        }
      }
      
      const grainOverlay = document.getElementById('sim-grain-overlay');
      if (grainOverlay) grainOverlay.style.opacity = iso.noise;
    }

    function onApertureChange(val) { cameraSim.apertureIdx = parseInt(val, 10); playDialClick(); updateCameraSimulator(); }
    function onShutterChange(val) { cameraSim.shutterIdx = parseInt(val, 10); playDialClick(); updateCameraSimulator(); }
    function onIsoChange(val) { cameraSim.isoIdx = parseInt(val, 10); playDialClick(); updateCameraSimulator(); }
    function onFocusRingChange(val) {
      cameraSim.focusPlane = parseInt(val, 10);
      playDialClick();
      const lbl = document.getElementById('slider-focus-label');
      if (lbl) lbl.innerText = val === '0' ? 'Objek Depan' : (val === '1' ? 'Subjek Utama' : 'Latar Belakang');
      updateCameraSimulator();
    }

    function setCameraPreset(mode) {
      playDialClick();
      if (mode === 'bokeh') { cameraSim.apertureIdx = 0; cameraSim.shutterIdx = 6; cameraSim.isoIdx = 0; }
      else if (mode === 'action') { cameraSim.apertureIdx = 1; cameraSim.shutterIdx = 7; cameraSim.isoIdx = 2; }
      const ia = document.getElementById('input-aperture');
      const is = document.getElementById('input-shutter');
      const ii = document.getElementById('input-iso');
      if (ia) ia.value = cameraSim.apertureIdx;
      if (is) is.value = cameraSim.shutterIdx;
      if (ii) ii.value = cameraSim.isoIdx;
      updateCameraSimulator();
    }

    function resetCameraSim() {
      cameraSim.apertureIdx = 1; cameraSim.shutterIdx = 4; cameraSim.isoIdx = 1; cameraSim.focusPlane = 1;
      const ia = document.getElementById('input-aperture');
      const is = document.getElementById('input-shutter');
      const ii = document.getElementById('input-iso');
      const ifoc = document.getElementById('input-focus');
      if (ia) ia.value = 1;
      if (is) is.value = 4;
      if (ii) ii.value = 1;
      if (ifoc) ifoc.value = 1;
      updateCameraSimulator();
    }

    function handleHalfPressShutter() {
      playAfBeepSound();
      const reticle = document.getElementById('sim-af-reticle');
      if (reticle) reticle.classList.add('border-emerald-400', 'bg-emerald-400/20');
    }

    function releaseHalfPressShutter() {
      const reticle = document.getElementById('sim-af-reticle');
      if (reticle) setTimeout(() => reticle.classList.remove('border-emerald-400', 'bg-emerald-400/20'), 200);
    }

    function handleFullCapture() {
      playShutterSound();
      const flash = document.getElementById('sim-scene-container');
      if (flash) {
        flash.classList.add('brightness-200');
        setTimeout(() => flash.classList.remove('brightness-200'), 150);
      }
      markStepComplete(1);
    }

    function checkQuiz(qNum, choice) {
      const fb = document.getElementById('quiz-feedback-1');
      if (!fb) return;
      fb.classList.remove('hidden');
      if (choice === 'B') {
        fb.className = 'mt-2 text-xs font-mono p-3 rounded-2xl bg-emerald-50 text-emerald-800 border border-emerald-200';
        fb.innerHTML = '<strong>BENAR! ✓</strong> Layar monitor LCD pada kamera digital memungkinkan fotografer mengevaluasi ketajaman secara instan dan mengambil ulang foto di lokasi.';
        markStepComplete(1);
      } else {
        fb.className = 'mt-2 text-xs font-mono p-3 rounded-2xl bg-red-50 text-red-700 border border-red-200';
        fb.innerHTML = 'Kurang tepat. Ingat keunggulan utama evaluasi langsung pada layar kamera digital!';
      }
    }

    function setFocusDemo(mode) {
      playShutterSound();
      const bg = document.getElementById('demo-bokeh-bg');
      const lbl = document.getElementById('demo-focus-label');
      const sub = document.getElementById('demo-focus-sub');
      const btnFront = document.getElementById('btn-focus-front');
      const btnBack = document.getElementById('btn-focus-back');
      if (mode === 'front') {
        if (bg) bg.style.filter = 'blur(10px)';
        if (lbl) lbl.innerText = 'OBJEK DEPAN TAJAM (IN FOCUS)';
        if (sub) sub.innerText = 'Latar Belakang Bokeh Halus • Ruang Tajam Sempit';
        if (btnFront) btnFront.className = 'w-full py-2.5 canva-gradient-bg text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-purple-500/20';
        if (btnBack) btnBack.className = 'w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all';
      } else {
        if (bg) bg.style.filter = 'blur(0px)';
        if (lbl) lbl.innerText = 'LATAR BELAKANG TAJAM';
        if (sub) sub.innerText = 'Objek Depan Samar • Ruang Tajam Terarah ke Belakang';
        if (btnBack) btnBack.className = 'w-full py-2.5 canva-gradient-bg text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-purple-500/20';
        if (btnFront) btnFront.className = 'w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all';
      }
    }

    function checkFocusExercise(ans) {
      const fb = document.getElementById('focus-exercise-feedback');
      if (!fb) return;
      fb.classList.remove('hidden');
      if (ans === 'B') {
        fb.className = 'p-3 rounded-2xl text-xs font-mono bg-emerald-50 text-emerald-800 border border-emerald-200';
        fb.innerHTML = '<strong>Tepat Sekali! ✓</strong> Objek utama (parfum) harus dikunci ketajamannya agar pesan visual produk tersampaikan jelas.';
        markStepComplete(2);
      } else {
        fb.className = 'p-3 rounded-2xl text-xs font-mono bg-red-50 text-red-700 border border-red-200';
        fb.innerHTML = 'Belum tepat. Jika fokus dikunci pada bunga hiasan, botol produk justru akan buram!';
      }
    }

    function animateRotDemo() {
      playShutterSound();
      const subject = document.getElementById('rot-moving-subject');
      const bubble = document.getElementById('rot-status-bubble');
      if (subject) {
        subject.style.left = '33.33%';
        subject.style.top = '33.33%';
      }
      if (bubble) bubble.innerText = 'Subjek digeser ke titik temu 1/3 (Golden Point) untuk daya tarik visual maksimal.';
    }

    function moveRotSubject(pos) {
      playShutterSound();
      const subject = document.getElementById('rot-moving-subject');
      const bubble = document.getElementById('rot-status-bubble');
      if (!subject || !bubble) return;
      if (pos === 'TL') { subject.style.left = '33.33%'; subject.style.top = '33.33%'; bubble.innerText = 'Terkunci di Titik Kiri Atas'; }
      if (pos === 'TR') { subject.style.left = '66.66%'; subject.style.top = '33.33%'; bubble.innerText = 'Terkunci di Titik Kanan Atas'; }
      if (pos === 'BL') { subject.style.left = '33.33%'; subject.style.top = '66.66%'; bubble.innerText = 'Terkunci di Titik Kiri Bawah'; }
      if (pos === 'BR') { subject.style.left = '66.66%'; subject.style.top = '66.66%'; bubble.innerText = 'Terkunci di Titik Kanan Bawah'; }
    }

    function completeQuickTask() {
      playShutterSound();
      const btn = document.getElementById('btn-quick-rot');
      if (btn) {
        btn.innerText = 'Misi Rule of Third Selesai ✓';
        btn.className = 'w-full py-2.5 bg-slate-100 text-emerald-600 font-bold text-xs rounded-xl transition-colors border border-emerald-300';
      }
      markStepComplete(3);
      if (!window.appState.completedMissions.includes(1)) {
        window.appState.completedMissions.push(1);
        localStorage.setItem('fobi_missions', JSON.stringify(window.appState.completedMissions));
        window.updateGlobalProgress();
      }
    }

    const compData = {
      simetris: {
        title: 'Komposisi Simetris',
        desc: 'Keseimbangan formal dengan membagi bidang foto menjadi dua bagian sama rata (kiri dan kanan). Objek utama diletakkan persis pada sumbu tengah vertikal untuk menciptakan kesan kokoh, rapi, dan seimbang.',
        img: 'https://lh3.googleusercontent.com/d/1_eNlPXq_oljHv1MOZgunvgp22pzQTw7g',
        action: 'Posisikan kamera tepat di sumbu tengah gerbang atau lorong simetris di SMKN 12 Surabaya.'
      },
      framing: {
        title: 'Framing',
        desc: 'Membingkai objek utama dengan elemen visual di sekitarnya.',
        img: 'https://lh3.googleusercontent.com/d/16_z0Y--rzdflmnnblt2XL2razi8DZsIV',
        action: 'Gunakan celah pagar atau lengkungan dinding untuk membingkai aktivitas teman.'
      },
      rot: {
        title: 'Rule of Third',
        desc: 'Membagi frame menjadi 9 kotak simetris dan menaruh objek di titik temu garis sepertiga.',
        img: 'https://lh3.googleusercontent.com/d/1arT2mTbnv-s2WCsBuFl_a485FutAAT1X',
        action: 'Nyalakan garis panduan grid 3×3 di ponsel/kamera dan kunci mata subjek pada titik temu.'
      },
      fillframe: {
        title: 'Fill the Frame',
        desc: 'Memenuhi seluruh bingkai foto dengan objek utama.',
        img: 'https://lh3.googleusercontent.com/d/1FUPObnPmiuh4lsw5vTnu8XkPF7abwTJE',
        action: 'Mendekatlah ke objek (close-up) hingga seluruh frame terisi tekstur objek.'
      },
      frameinframe: {
        title: 'Frame in Frame',
        desc: 'Memanfaatkan bingkai alami seperti pintu kelas, jendela, atau dedaunan.',
        img: 'https://lh3.googleusercontent.com/d/1Hs6DbUozVtaGclSbUTgo8C_d4q2YaWEr',
        action: 'Potret teman dari dalam kelas melalui kusen jendela yang terbuka.'
      },
      leadinglines: {
        title: 'Leading Lines',
        desc: 'Garis nyata atau imajiner yang menuntun mata penonton menuju objek utama.',
        img: 'https://lh3.googleusercontent.com/d/1ANBSVmAJ8G6vJebHwAR1dKhPMuSWzC6q',
        action: 'Manfaatkan garis ubin lorong sekolah dari sudut rendah (low angle).'
      },
      negativespace: {
        title: 'Negative Space',
        desc: 'Menyediakan porsi ruang kosong luas di sekitar objek.',
        img: 'https://lh3.googleusercontent.com/d/1P0a8XA6N4BMt-H3p6zpOQ1XvEPtB_BsF',
        action: 'Potret objek di depan dinding polos dengan ruang kosong mendominasi frame.'
      },
      goldenratio: {
        title: 'Golden Ratio (1:1.618)',
        desc: 'Proporsi spiral Fibonacci yang memandu pandangan mata secara organik.',
        img: 'https://lh3.googleusercontent.com/d/1Ji1NJusYceZeluKVe-0h_XR4ELaQKWll',
        action: 'Gunakan kurva tangga melingkar untuk memandu alur pandang.'
      }
    };

    let isCompGridVisible = true;
    function openCompModal(type) {
      const d = compData[type];
      if (!d) return;
      const title = document.getElementById('modal-comp-title');
      const desc = document.getElementById('modal-comp-desc');
      const img = document.getElementById('modal-comp-img');
      const action = document.getElementById('modal-comp-action');
      const modal = document.getElementById('modal-comp');
      const simGrid = document.getElementById('modal-comp-simetris-grid');
      const btnToggle = document.getElementById('btn-toggle-comp-grid');
      const btnToggleLabel = document.getElementById('btn-toggle-comp-grid-label');
      
      if (title) title.innerText = d.title;
      if (desc) desc.innerText = d.desc;
      if (img) img.src = d.img;
      if (action) action.innerText = d.action;
      
      if (type === 'simetris') {
        isCompGridVisible = true;
        if (simGrid) simGrid.classList.remove('hidden');
        if (btnToggle) btnToggle.classList.remove('hidden');
        if (btnToggleLabel) btnToggleLabel.innerText = 'Sembunyikan Grid Simetri';
      } else {
        if (simGrid) simGrid.classList.add('hidden');
        if (btnToggle) btnToggle.classList.add('hidden');
      }
      if (modal) modal.classList.remove('hidden');
    }

    function toggleCompGrid() {
      playDialClick();
      const simGrid = document.getElementById('modal-comp-simetris-grid');
      const btnToggleLabel = document.getElementById('btn-toggle-comp-grid-label');
      if (!simGrid) return;
      isCompGridVisible = !isCompGridVisible;
      if (isCompGridVisible) {
        simGrid.classList.remove('hidden');
        if (btnToggleLabel) btnToggleLabel.innerText = 'Sembunyikan Grid Simetri';
      } else {
        simGrid.classList.add('hidden');
        if (btnToggleLabel) btnToggleLabel.innerText = 'Tampilkan Grid Simetri';
      }
    }

    function closeCompModal() {
      const modal = document.getElementById('modal-comp');
      const simGrid = document.getElementById('modal-comp-simetris-grid');
      if (simGrid) simGrid.classList.add('hidden');
      if (modal) modal.classList.add('hidden');
    }

    const techData = {
      dof: {
        title: 'Depth of Field (DoF)',
        desc: 'Kedalaman ruang fokus untuk memisahkan objek utama dari latar belakang bokeh.',
        task: 'Gunakan bukaan f/1.8 atau f/2.8, potret produk tumbler di atas meja dengan latar blur.',
        setupLab: function(container) {
          container.innerHTML = `
            <div class="aspect-video bg-black rounded-2xl overflow-hidden relative flex items-center justify-center">
              <div id="lab-dof-bg" class="absolute inset-0 bg-cover bg-center transition-all" style="background-image: url('https://lh3.googleusercontent.com/d/1oKXYbZFNrylU3ofJAm1H6A6x0fX4jCcj'); filter: blur(12px);"></div>
              <div class="relative z-10 p-3 bg-black/75 rounded-xl border border-cyan-400 text-center">
                <i class="fa-solid fa-wine-bottle text-2xl text-cyan-400"></i>
                <div class="text-[10px] font-mono font-bold text-white mt-1">PRODUK: TAJAM</div>
              </div>
            </div>
            <div class="mt-2.5 space-y-1 text-xs font-mono">
              <div class="flex justify-between"><span class="text-slate-300">Diafragma:</span><span id="lab-dof-label" class="text-cyan-400 font-bold">f/1.8 (Bokeh)</span></div>
              <input type="range" min="1" max="16" step="1" value="1" oninput="updateDofLab(this.value)" class="w-full accent-cyan-400 h-2 bg-slate-800 rounded">
            </div>
          `;
        }
      },
      freezing: {
      title: 'Freezing (≥ 1/250s)',
      desc: 'Membekukan pergerakan cepat subjek agar tampak terhenti di udara tanpa jejak biur.',
      task: 'Minta teman melompat di depan sekolah, gunakan shutter speed 1/500s atau 1/1000s.',
      setupLab: function(container) {
        container.innerHTML = `
          <div class="aspect-video bg-slate-950 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden">
            <div id="lab-freeze-icon" class="absolute inset-0 flex items-center justify-center transition-all duration-300">
              <img src="https://lh3.googleusercontent.com/d/1Tv-dOwH_BSaUFih7OVCfz7NH-NFfnllW" class="w-full h-full object-cover">
            </div>
            <div id="lab-freeze-blur-trail" class="absolute inset-0 opacity-0 blur-sm pointer-events-none flex items-center justify-center overflow-hidden">
              <img src="https://lh3.googleusercontent.com/d/1Tv-dOwH_BSaUFih7OVCfz7NH-NFfnllW" class="w-full h-full object-cover">
            </div>
            <div id="lab-freeze-status" class="absolute bottom-2 z-10 text-[10px] font-mono text-emerald-400 font-bold bg-black/60 px-2.5 py-0.5 rounded">STATUS: BEKU (1/1000s)</div>
          </div>
          <div class="mt-2.5 space-y-1 text-xs font-mono">
            <div class="flex justify-between"><span class="text-slate-300">Speed:</span><span id="lab-freeze-label" class="text-cyan-400 font-bold">1/1000s</span></div>
            <input type="range" min="0" max="3" step="1" value="3" oninput="updateFreezeLab(this.value)" class="w-full accent-cyan-400 h-2 bg-slate-800 rounded">
          </div>
        `;
      }
    },
      bulb: {
        title: 'Bulb / Light Painting',
        desc: 'Shutter speed dibuka berdurasi lama sehingga cahaya bergerak membentuk guratan garis.',
        task: 'Letakkan kamera stabil di tripod, atur shutter 4 detik di ruang gelap, gambar dengan lampu ponsel.',
        setupLab: function(container) {
          container.innerHTML = `
            <div class="aspect-video bg-black rounded-2xl relative overflow-hidden">
              <canvas id="bulb-paint-canvas" width="400" height="225" class="w-full h-full cursor-crosshair"></canvas>
              <div class="absolute top-2 left-2 text-[9px] font-mono text-cyan-400 bg-black/75 px-2 py-0.5 rounded pointer-events-none">Klik & Geser Mouse untuk Melukis Cahaya</div>
            </div>
            <div class="mt-2.5 flex justify-between">
              <button onclick="clearBulbCanvas()" class="px-3 py-1 bg-slate-800 text-slate-200 text-[10px] font-mono rounded-lg border border-slate-700">Hapus Kanvas</button>
              <span class="text-[10px] font-mono text-slate-400">Mode Bulb 4s</span>
            </div>
          `;
          setTimeout(initBulbCanvas, 80);
        }
      },
      panning: {
        title: 'Panning (1/30s)',
        desc: 'Kamera digerakkan mengikuti arah laju subjek secara horizontal selama shutter terbuka.',
        task: 'Berdiri di depan gerbang sekolah, atur speed 1/30s, ayunkan kamera selaras laju motor.',
        setupLab: function(container) {
          container.innerHTML = `
            <div class="aspect-video bg-black rounded-2xl relative overflow-hidden flex items-center justify-center">
              <div id="lab-panning-bg" class="absolute inset-0 bg-cover bg-center transition-all duration-300 " style="background-image: url('https://lh3.googleusercontent.com/d/1OLS3VlmY47_47E0PhD-1kac4eahUsKMQ');"></div>
              <div class="relative z-10 p-3 bg-black/75 rounded-2xl border border-emerald-400 flex items-center gap-2">
                <i class="fa-solid fa-motorcycle text-3xl text-emerald-400"></i>
                <span class="text-[10px] font-mono font-bold text-white">SUBJEK TAJAM | LATAR BLUR</span>
              </div>
            </div>
            <button onclick="togglePanningDemo()" class="mt-2.5 w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs font-mono rounded-xl shadow-sm">Simulasikan Sapuan Kamera</button>
          `;
        }
      },
      siluet: {
        title: 'Siluet Backlight',
        desc: 'Menempatkan objek membelakangi sumber cahaya utama dan mengukur metering ke latar langit.',
        task: 'Potret profil wajah teman di depan jendela kelas saat sore tanpa menyalakan lampu kilat.',
        setupLab: function(container) {
          container.innerHTML = `
            <div class="aspect-video rounded-2xl relative overflow-hidden flex items-center justify-center bg-gradient-to-t from-amber-600 to-sky-600">
              <div id="lab-siluet-person" class="absolute inset-0 flex items-center justify-center transition-all duration-300">
                <img src="https://lh3.googleusercontent.com/d/1pK6j2lKQ4AVDvHO9MPLNvc5V-s3NxZ_5" class="w-full h-full object-cover rounded-xl transition-all">
              </div>
            </div>
            <div class="mt-2.5 grid grid-cols-2 gap-2 text-xs font-mono">
              <button type="button" id="btn-siluet-sky" onclick="setSiluetLab('sky')" aria-pressed="false" class="py-2 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl hover:bg-slate-700 transition-all duration-200">Ukur ke Langit (Benar)<span class="siluet-check hidden ml-1" aria-hidden="true">✓</span></button>
              <button type="button" id="btn-siluet-sub" onclick="setSiluetLab('subject')" aria-pressed="false" class="py-2 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl hover:bg-slate-700 transition-all duration-200">Ukur ke Subjek<span class="siluet-check hidden ml-1" aria-hidden="true">✓</span></button>
            </div>
          `;
        }
      },
      raw: {
        title: 'RAW Processing',
        desc: 'Format mentah tanpa kompresi sehingga leluasa diolah di Adobe Lightroom.',
        task: 'Atur kualitas foto kamera ke format RAW, lalu evaluasi highlight dan shadow-nya.',
        setupLab: function(container) {
          container.innerHTML = `
            <div class="aspect-video bg-black rounded-2xl relative overflow-hidden">
              <div id="lab-raw-visual" class="absolute inset-0 bg-cover bg-center transition-all duration-500" style="background-image: url('https://lh3.googleusercontent.com/d/1L9C8tBjGeeRsnm84N_Y3kRcEsRoWoNug'); filter: contrast(115%) saturate(125%) brightness(105%);"></div>
              <div id="lab-raw-badge" class="absolute top-2 left-2 bg-black/75 px-2.5 py-0.5 rounded-lg text-[10px] font-mono text-purple-400 font-bold border border-purple-500/40">RAW COLOR GRADED</div>
            </div>
            <div class="mt-2.5 flex gap-2 text-xs font-mono">
              <button type="button" id="btn-raw-jpeg" onclick="toggleRawDemo(false)" aria-pressed="false" class="flex-1 py-2 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl hover:bg-slate-700 transition-all duration-200">JPEG Standar<span class="raw-check hidden ml-1" aria-hidden="true">✓</span></button>
              <button type="button" id="btn-raw-graded" onclick="toggleRawDemo(true)" aria-pressed="false" class="flex-1 py-2 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl hover:bg-slate-700 transition-all duration-200">RAW Graded<span class="raw-check hidden ml-1" aria-hidden="true">✓</span></button>
            </div>
          `;
        }
      }
    };
    
    function openTechniqueDemo(code) {
      const d = techData[code];
      if (!d) return;
      const title = document.getElementById('modal-tech-title');
      const desc = document.getElementById('modal-tech-desc');
      const task = document.getElementById('modal-tech-task');
      const stage = document.getElementById('modal-tech-interactive-stage');
      const modal = document.getElementById('modal-technique');
      if (title) title.innerText = d.title;
      if (desc) desc.innerText = d.desc;
      if (task) task.innerText = d.task;
      if (stage && d.setupLab) d.setupLab(stage);
      if (modal) modal.classList.remove('hidden');
    }
    
    function closeTechniqueModal() {
      const modal = document.getElementById('modal-technique');
      if (modal) modal.classList.add('hidden');
    }
    
    function updateDofLab(val) {
      const bg = document.getElementById('lab-dof-bg');
      const lbl = document.getElementById('lab-dof-label');
      playDialClick();
      if (!bg || !lbl) return;
      if (val <= 3) { bg.style.filter = 'blur(12px)'; lbl.innerText = 'f/1.8 (Bokeh Halus)'; }
      else if (val <= 8) { bg.style.filter = 'blur(5px)'; lbl.innerText = 'f/5.6 (Sedang)'; }
      else { bg.style.filter = 'blur(0px)'; lbl.innerText = 'f/16 (Latar Tajam)'; }
    }
    
    function updateFreezeLab(val) {
      const icon = document.getElementById('lab-freeze-icon');
      const ghost = document.getElementById('lab-freeze-blur-trail');
      const status = document.getElementById('lab-freeze-status');
      const lbl = document.getElementById('lab-freeze-label');
      playDialClick();
      if (!icon || !ghost || !status || !lbl) return;
      if (val === '0') {
        ghost.style.opacity = '1'; icon.style.filter = 'blur(4px)';
        status.innerText = 'BURAM (1/30s)'; status.className = 'mt-2 text-[10px] font-mono text-red-400 font-bold bg-black/60 px-2 py-0.5 rounded';
        lbl.innerText = '1/30s (Terlalu Lambat)';
      } else if (val === '1') {
        ghost.style.opacity = '0.5'; icon.style.filter = 'blur(1.5px)';
        status.innerText = 'AGAK GOYANG (1/125s)'; status.className = 'mt-2 text-[10px] font-mono text-amber-400 font-bold bg-black/60 px-2 py-0.5 rounded';
        lbl.innerText = '1/125s';
      } else if (val === '2') {
        ghost.style.opacity = '0'; icon.style.filter = 'none';
        status.innerText = 'TERBEKUKAN (1/250s)'; status.className = 'mt-2 text-[10px] font-mono text-emerald-400 font-bold bg-black/60 px-2 py-0.5 rounded';
        lbl.innerText = '1/250s (Standar)';
      } else {
        ghost.style.opacity = '0'; icon.style.filter = 'none';
        status.innerText = 'BEKU TOTAL (1/1000s)'; status.className = 'mt-2 text-[10px] font-mono text-cyan-400 font-bold bg-black/60 px-2 py-0.5 rounded';
        lbl.innerText = '1/1000s';
      }
    }
    
    let isDrawingBulb = false;
    function initBulbCanvas() {
      const canvas = document.getElementById('bulb-paint-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#00C4CC'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.shadowBlur = 10; ctx.shadowColor = '#00C4CC';
      canvas.onmousedown = (e) => {
        isDrawingBulb = true; ctx.beginPath();
        const r = canvas.getBoundingClientRect();
        ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
      };
      canvas.onmousemove = (e) => {
        if (!isDrawingBulb) return;
        const r = canvas.getBoundingClientRect();
        ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
        ctx.stroke();
      };
      window.onmouseup = () => isDrawingBulb = false;
    }
    function clearBulbCanvas() {
      const canvas = document.getElementById('bulb-paint-canvas');
      if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
    
    function togglePanningDemo() {
      playShutterSound();
      const bg = document.getElementById('lab-panning-bg');
      if (bg) {
        bg.classList.add('translate-x-6');
        setTimeout(() => bg.classList.remove('translate-x-6'), 400);
      }
    }
    
    function setSiluetLab(mode) {
      if (mode !== 'sky' && mode !== 'subject') return;
      const person = document.getElementById('lab-siluet-person');
      const buttons = [
        { element: document.getElementById('btn-siluet-sky'), mode: 'sky' },
        { element: document.getElementById('btn-siluet-sub'), mode: 'subject' }
      ];
      if (!person || buttons.some(({ element }) => !element)) return;

      playDialClick();
      if (mode === 'sky') person.className = 'relative z-10 text-black transition-all';
      else person.className = 'relative z-10 text-amber-200 brightness-150 transition-all';

      buttons.forEach(({ element, mode: buttonMode }) => {
        const isActive = mode === buttonMode;
        element.setAttribute('aria-pressed', String(isActive));
        element.classList.toggle('bg-amber-600', isActive);
        element.classList.toggle('text-white', isActive);
        element.classList.toggle('font-bold', isActive);
        element.classList.toggle('border-amber-300', isActive);
        element.classList.toggle('ring-2', isActive);
        element.classList.toggle('ring-amber-400/70', isActive);
        element.classList.toggle('bg-slate-800', !isActive);
        element.classList.toggle('text-slate-300', !isActive);
        element.classList.toggle('border-slate-700', !isActive);
        element.querySelector('.siluet-check')?.classList.toggle('hidden', !isActive);
      });
    }
    
    function toggleRawDemo(isRaw) {
      playDialClick();
      const img = document.getElementById('lab-raw-visual');
      const badge = document.getElementById('lab-raw-badge');
      const buttons = [
        { element: document.getElementById('btn-raw-jpeg'), isRaw: false },
        { element: document.getElementById('btn-raw-graded'), isRaw: true }
      ];
      if (!img || !badge || buttons.some(({ element }) => !element)) return;
      if (isRaw) {
        img.style.filter = 'contrast(115%) saturate(125%) brightness(105%)';
        badge.innerText = 'RAW COLOR GRADED';
        badge.className = 'absolute top-2 left-2 bg-black/75 px-2.5 py-0.5 rounded-lg text-[10px] font-mono text-purple-400 font-bold border border-purple-500/40';
      } else {
        img.style.filter = 'contrast(90%) saturate(85%)';
        badge.innerText = 'JPEG STANDAR';
        badge.className = 'absolute top-2 left-2 bg-black/75 px-2.5 py-0.5 rounded-lg text-[10px] font-mono text-slate-400 font-bold border border-slate-700';
      }

      buttons.forEach(({ element, isRaw: buttonIsRaw }) => {
        const isActive = isRaw === buttonIsRaw;
        element.setAttribute('aria-pressed', String(isActive));
        element.classList.toggle('bg-purple-600', isActive);
        element.classList.toggle('text-white', isActive);
        element.classList.toggle('font-bold', isActive);
        element.classList.toggle('border-purple-300', isActive);
        element.classList.toggle('ring-2', isActive);
        element.classList.toggle('ring-purple-400/70', isActive);
        element.classList.toggle('bg-slate-800', !isActive);
        element.classList.toggle('text-slate-300', !isActive);
        element.classList.toggle('border-slate-700', !isActive);
        element.querySelector('.raw-check')?.classList.toggle('hidden', !isActive);
      });
    }
    
    const genreData = {
      creative: {
        title: 'Creative (Fiksi)',
        desc: 'Rekayasa artistik dan konsep visual terencana untuk komersial maupun seni rupa.',
        categories: ['Food and Decor', 'Commercial', 'Product', 'Advertising', 'Fine Art', 'Still Life', 'Fashion', 'Catalogue', 'Studio', 'Creative Stock']
      },
      editorial: {
        title: 'Editorial',
        desc: 'Fotografi yang menyertai narasi teks publikasi jurnalistik atau dokumentasi faktual.',
        categories: ['Photojournalism', 'Documentary', 'Sports', 'Travel', 'Nature', 'Landscape', 'Wildlife', 'Architectural', 'Scientific & Medical']
      },
      retail: {
        title: 'Retail (Fiksi & Tidak Fiksi)',
        desc: 'Layanan jasa fotografi untuk mengabadikan momen khusus keluarga maupun perorangan.',
        categories: ['Portraiture', 'Wedding & Prewedding', 'Event & Celebration', 'School & Graduation', 'Family Photography']
      },
      personal: {
        title: 'Personal (Cenderung Tidak Fiksi)',
        desc: 'Dokumentasi mandiri non-komersial fotografer untuk catatan visual sehari-hari atau hobi.',
        categories: ['Personal Daily Archive', 'Street Photography', 'Personal Travel Diary', 'Experimental Hobby']
      }
    };
    
    function switchGenreCategory(cat) {
      const d = genreData[cat];
      if (!d) return;
      ['creative', 'editorial', 'retail', 'personal'].forEach(c => {
        const btn = document.getElementById(`genre-tab-${c}`);
        if (btn) {
          if (c === cat) btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold canva-gradient-bg text-white shadow-xs';
          else btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold bg-white text-slate-700 border border-slate-200 shadow-xs hover:border-purple-300';
        }
      });
      const container = document.getElementById('genre-content-container');
      if (!container) return;
      const tags = d.categories.map(item => `
        <div class="bg-slate-50 border border-slate-200 p-3 rounded-2xl flex items-center gap-2 text-xs text-slate-800">
          <i class="fa-solid fa-tag text-purple-600 text-[10px]"></i>
          <span>${item}</span>
        </div>
      `).join('');
      container.innerHTML = `
        <div class="mb-3">
          <h4 class="text-sm font-bold text-slate-900">${d.title}</h4>
          <p class="text-xs text-slate-500 mt-0.5">${d.desc}</p>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${tags}</div>
      `;
    }
    
    function updateAssistantProgress() {
      const chks = document.querySelectorAll('.chk-assist:checked');
      const counter = document.getElementById('assist-step-counter');
      if (counter) counter.innerText = `${chks.length} / 8 Checklist Terpenuhi`;
      if (chks.length >= 6) markStepComplete(6);
    }
    
    function calculateEvaluation() {
      const checkedCount = document.querySelectorAll('.eval-chk:checked').length;
      const statusLabel = document.getElementById('eval-status-label');
      const badge = document.getElementById('eval-result-badge');
      const tip = document.getElementById('eval-tip-text');
      if (badge) badge.classList.remove('border-red-500', 'border-amber-500', 'border-emerald-500', 'bg-emerald-50', 'bg-amber-50', 'bg-red-50');
      if (checkedCount <= 4) {
        if (statusLabel) { statusLabel.innerText = 'Belum Siap'; statusLabel.className = 'text-xs font-bold text-red-500'; }
        if (badge) badge.classList.add('border-red-200', 'bg-red-50');
        if (tip) tip.innerText = 'Perbaiki fokus atau pencahayaan sebelum mengumpulkan tugas.';
      } else if (checkedCount <= 7) {
        if (statusLabel) { statusLabel.innerText = 'Perlu Revisi'; statusLabel.className = 'text-xs font-bold text-amber-500'; }
        if (badge) badge.classList.add('border-amber-200', 'bg-amber-50');
        if (tip) tip.innerText = 'Sebagian kriteria sudah baik, periksa kembali ketajaman objek utama.';
      } else {
        if (statusLabel) { statusLabel.innerText = 'Siap Dikumpulkan ✓'; statusLabel.className = 'text-xs font-bold text-emerald-600'; }
        if (badge) badge.classList.add('border-emerald-200', 'bg-emerald-50');
        if (tip) tip.innerText = 'Karya memenuhi kriteria komposisi, fokus, dan kreativitas visual!';
        markStepComplete(7);
      }
    }
    
    function resetEvaluation() {
      document.querySelectorAll('.eval-chk').forEach(c => c.checked = false);
      calculateEvaluation();
    }
    
    let selectedScale = 3;
    function selectReflectScale(idx) {
      selectedScale = idx;
      for (let i = 1; i <= 4; i++) {
        const btn = document.getElementById(`btn-scale-${i}`);
        if (!btn) continue;
        if (i === idx) {
          btn.className = 'p-3 rounded-2xl bg-purple-50 border-2 border-purple-500 text-center cursor-pointer transition-all shadow-sm';
        } else {
          btn.className = 'p-3 rounded-2xl bg-slate-50 border border-slate-200 text-center cursor-pointer transition-all hover:border-slate-300';
        }
      }
    }
    
    function saveReflection() {
      if (!isStudentLoggedIn()) {
        openLoginModal('student');
        alertBox('🔒 Silakan isi identitas siswa sebelum menyimpan refleksi.');
        return;
      }
      playShutterSound();
      const q1 = document.getElementById('ref-q1')?.value.trim() || '';
      const q2 = document.getElementById('ref-q2')?.value.trim() || '';
      const q3 = document.getElementById('ref-q3')?.value.trim() || '';
      const q4 = document.getElementById('ref-q4')?.value.trim() || '';
      const q5 = document.getElementById('ref-q5')?.value.trim() || '';
      const reflectionData = { q1, q2, q3, q4, q5, scale: selectedScale };
      localStorage.setItem('fobi_reflection', JSON.stringify(reflectionData));
      const a = document.getElementById('reflection-save-alert');
      if (a) {
        a.classList.remove('hidden');
        a.innerText = 'Refleksi berhasil disimpan ke akun Anda!';
        setTimeout(() => a.classList.add('hidden'), 4000);
      }
      markStepComplete(8);
    }
    
    function exportReflectionText() {
      const q1 = document.getElementById('ref-q1')?.value || '-';
      const q2 = document.getElementById('ref-q2')?.value || '-';
      const q3 = document.getElementById('ref-q3')?.value || '-';
      const q4 = document.getElementById('ref-q4')?.value || '-';
      const q5 = document.getElementById('ref-q5')?.value || '-';
      const profile = window.appState?.studentProfile;
      const summary = `=== REFLEKSI FOTOGRAFI DASAR KELAS XI DKV SMKN 12 SURABAYA ===\n` +
        `Nama Siswa: ${profile ? profile.name : 'Siswa'}\n` +
        `Kelas: ${profile ? profile.studentClass : 'X FILM'}\n` +
        `1. Paling Mudah: ${q1}\n` +
        `2. Paling Menantang: ${q2}\n` +
        `3. Kesalahan Awal: ${q3}\n` +
        `4. Perbaikan: ${q4}\n` +
        `5. Minat Lanjutan: ${q5}\n` +
        `Skala Kepahaman: ${selectedScale}/4\n` +
        `Sumber: Bab 8 Kemendikbudristek 2023.`;
      const t = document.createElement('textarea');
      t.value = summary;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      document.body.removeChild(t);
      const a = document.getElementById('reflection-save-alert');
      if (a) {
        a.classList.remove('hidden');
        a.innerText = 'Teks refleksi berhasil disalin ke clipboard!';
        setTimeout(() => a.classList.add('hidden'), 4000);
      }
    }
    
    let activeUploadedBase64 = null;
    function transformGoogleDriveLink(url) {
      if (!url) return '';
      const trimmed = url.trim();
      const driveMatch = trimmed.match(/(?:file\/d\/|id=)([a-zA-Z0-9_-]{25,})/);
      if (driveMatch && driveMatch[1]) {
        return `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
      }
      return trimmed;
    }
    
    let imageProcessing = false;
    let imageProcessingVersion = 0;
    let imageProcessingError = '';

    function setImageUploadStatus(state, message) {
      const info = document.getElementById('submit-file-size-info');
      if (!info) return;

      const stateClasses = {
        normal: ['bg-white', 'border-slate-200', 'text-slate-600'],
        processing: ['bg-amber-50', 'border-amber-300', 'text-amber-800'],
        success: ['bg-emerald-50', 'border-emerald-300', 'text-emerald-800'],
        error: ['bg-red-50', 'border-red-300', 'text-red-700']
      };
      Object.values(stateClasses).flat().forEach(className => info.classList.remove(className));
      info.classList.add(...(stateClasses[state] || stateClasses.normal));
      info.textContent = message;
    }

    async function handleImageFilePicker(event) {
      const version = ++imageProcessingVersion;
      const file = event.target.files[0];
      const button = document.getElementById('btn-submit-task');
      const previewBox = document.getElementById('submit-file-preview-box');
      activeUploadedBase64 = null;
      imageProcessingError = '';
      previewBox.classList.add('hidden');
      imageProcessing = Boolean(file);
      button.disabled = imageProcessing;
      if (!file) {
        setImageUploadStatus('normal', 'Belum ada foto dipilih');
        return;
      }
      setImageUploadStatus('processing', `${file.name} — Sedang memproses foto...`);
      const objectUrl = URL.createObjectURL(file);
      try {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('Foto tidak dapat dibaca. Pilih gambar JPEG, PNG, atau WebP yang valid.'));
          img.src = objectUrl;
        });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Browser tidak dapat memproses gambar dengan Canvas.');
        const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        let width = Math.max(1, Math.round(img.naturalWidth * scale));
        let height = Math.max(1, Math.round(img.naturalHeight * scale));
        let quality = 0.75;
        let type = 'image/webp';
        let blob;
        // Always draw from the original image to avoid cumulative compression loss.
        for (let attempt = 0; attempt < 16; attempt++) {
          if (version !== imageProcessingVersion) return;
          canvas.width = width;
          canvas.height = height;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const encode = mime => new Promise(resolve => canvas.toBlob(resolve, mime, quality));
          blob = await encode(type);
          if (type === 'image/webp' && (!blob || blob.type !== 'image/webp')) {
            type = 'image/jpeg';
            blob = await encode(type);
          }
          if (!blob || blob.type !== type) throw new Error('Browser gagal mengompresi foto. Coba browser lain atau pilih foto lain.');
          if (blob.size <= 150 * 1024) break;
          if (quality > 0.45) {
            quality = Math.max(0.45, Number((quality - 0.1).toFixed(2)));
          } else {
            width = Math.max(1, Math.round(width * 0.8));
            height = Math.max(1, Math.round(height * 0.8));
          }
        }
        if (blob.size > 200 * 1024) throw new Error('Foto masih melebihi 200 KB setelah kompresi. Pilih foto berukuran lebih kecil.');
        if (version !== imageProcessingVersion) return;
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Hasil kompresi tidak dapat dibaca. Silakan pilih foto kembali.'));
          reader.readAsDataURL(blob);
        });
        if (version !== imageProcessingVersion) return;
        activeUploadedBase64 = base64;
        document.getElementById('submit-url').value = '';
        document.getElementById('submit-file-preview-img').src = base64;
        previewBox.classList.remove('hidden');
        setImageUploadStatus('success', `${file.name} — Foto siap diunggah ✓ | ${(file.size / 1024).toFixed(1)} KB → ${(blob.size / 1024).toFixed(1)} KB (${type === 'image/webp' ? 'WebP' : 'JPEG'}, ${width} x ${height} px)`);
      } catch (error) {
        if (version !== imageProcessingVersion) return;
        imageProcessingError = error.message || 'Foto gagal diproses. Silakan pilih foto lain.';
        setImageUploadStatus('error', `${file.name} — Gagal: ${imageProcessingError}`);
        alertBox(imageProcessingError);
      } finally {
        URL.revokeObjectURL(objectUrl);
        if (version === imageProcessingVersion) {
          imageProcessing = false;
          button.disabled = false;
        }
      }
    }

    function handleUrlInputPreview(url) {
      ++imageProcessingVersion;
      imageProcessing = false;
      imageProcessingError = '';
      activeUploadedBase64 = null;
      document.getElementById('btn-submit-task').disabled = false;
      document.getElementById('submit-file-input').value = '';
      setImageUploadStatus('normal', 'Belum ada foto dipilih');
      const previewBox = document.getElementById('submit-file-preview-box');
      const previewImg = document.getElementById('submit-file-preview-img');
      const directUrl = transformGoogleDriveLink(url);
      previewBox.classList.toggle('hidden', !directUrl);
      if (directUrl) previewImg.src = directUrl;
    }

    function openPhotoPreviewModal(imgUrl, title, studentName, studentClass, tech) {
      const pImg = document.getElementById('preview-modal-img');
      const pTitle = document.getElementById('preview-modal-title');
      const pAuthor = document.getElementById('preview-modal-author');
      const pTech = document.getElementById('preview-modal-tech');
      const modal = document.getElementById('modal-photo-preview');
      if (pImg) pImg.src = imgUrl;
      if (pTitle) pTitle.innerText = title;
      if (pAuthor) pAuthor.innerText = `${studentName} • ${studentClass}`;
      if (pTech) pTech.innerText = tech || 'Pengaturan Kamera Standar';
      if (modal) modal.classList.remove('hidden');
    }
    
    function closePhotoPreviewModal() {
      const modal = document.getElementById('modal-photo-preview');
      if (modal) modal.classList.add('hidden');
    }
    
    function openSubmitFormModal() {
      if (!isStudentLoggedIn()) {
        openLoginModal('student');
        alertBox('Silakan masukkan Nama & Kelas terlebih dahulu sebelum mengumpulkan tugas.');
        return;
      }
      ++imageProcessingVersion;
      imageProcessing = false;
      imageProcessingError = '';
      document.getElementById('btn-submit-task').disabled = false;
      setImageUploadStatus('normal', 'Belum ada foto dipilih');
      activeUploadedBase64 = null;
      const fIn = document.getElementById('submit-file-input');
      const uIn = document.getElementById('submit-url');
      const pBox = document.getElementById('submit-file-preview-box');
      const modal = document.getElementById('modal-submit');
      if (fIn) fIn.value = '';
      if (uIn) uIn.value = '';
      if (pBox) pBox.classList.add('hidden');
      if (modal) modal.classList.remove('hidden');
    }
    
    function closeSubmitModal() {
      const modal = document.getElementById('modal-submit');
      if (modal) modal.classList.add('hidden');
    }
    
    async function handleRealPhotoSubmission(event) {
      event.preventDefault();
      if (imageProcessing || imageProcessingError) {
        alertBox(imageProcessing ? 'Tunggu sampai kompresi foto selesai sebelum mengirim.' : imageProcessingError);
        return;
      }
      const profile = window.appState?.studentProfile || window.appState?.teacherProfile;
      if (!profile) {
        openLoginModal('student');
        return;
      }
      const mission = document.getElementById('submit-mission').value;
      const title = document.getElementById('submit-title').value.trim();
      const rawUrl = document.getElementById('submit-url').value.trim();
      const shutter = document.getElementById('submit-shutter').value.trim();
      const aperture = document.getElementById('submit-aperture').value.trim();
      const iso = document.getElementById('submit-iso').value.trim();
      const notes = document.getElementById('submit-notes').value.trim();
      let photoUrl = activeUploadedBase64;
      let originalUrl = null;
      if (!photoUrl && rawUrl) {
        photoUrl = transformGoogleDriveLink(rawUrl);
        originalUrl = rawUrl;
      }
      if (!photoUrl) {
        alertBox('⚠️ Silakan pilih file foto atau masukkan tautan foto Anda.');
        return;
      }
      const subId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const payload = {
        id: subId,
        studentName: profile.name,
        studentClass: profile.studentClass || 'Pengajar DKV',
        studentNis: profile.nis || '-',
        mission,
        title,
        photoUrl,
        originalUrl,
        shutter,
        aperture,
        iso,
        notes,
        submittedAt: new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
        timestamp: new Date().toISOString()
      };
      
      galleryItems = [payload, ...galleryItems.filter(item => item.id !== payload.id)];
      const curList = window.appState?.gallerySubmissions || [];
      curList.unshift(payload);
      window.appState.gallerySubmissions = curList;
      localStorage.setItem('fobi_gallery_submissions', JSON.stringify(curList));
      if (ENABLE_FIREBASE_ONLINE && db) {
        try {
          await db.collection("gallery").doc(subId).set(payload);
        } catch (error) {
          console.warn("Gagal sinkron cloud, tersimpan di perangkat lokal:", error);
        }
      }
      renderRealStudentGallery(window.currentGalleryFilter || 'all');
      if (isTeacherLoggedIn()) renderTeacherTable();
      closeSubmitModal();
      playShutterSound();
      alertBox('Karya foto berhasil disimpan & diterbitkan ke galeri kelas!');
    }
    
    function renderRealStudentGallery(filterCategory = 'all') {
      updateGalleryPagingUI();
      const grid = document.getElementById('gallery-grid');
      const emptyState = document.getElementById('gallery-empty-state');
      const totalCount = document.getElementById('total-gallery-count');
      const list = galleryItems;
      if (totalCount) totalCount.innerText = list.length;
      if (!grid) return;
      if (!galleryReady && !galleryUsingFallback) {
        grid.innerHTML = '';
        emptyState?.classList.add('hidden');
        return;
      }
      
      const filtered = filterCategory === 'all' 
        ? list 
        : list.filter(item => item.mission === filterCategory);
        
      if (filtered.length === 0) {
        grid.innerHTML = '';
        if (emptyState) {
          emptyState.classList.remove('hidden');
          const title = emptyState.querySelector('h3');
          const description = emptyState.querySelector('p');
          const partial = galleryHasMore || Boolean(galleryError);
          if (title) title.textContent = partial ? 'Belum ada karya yang cocok pada data yang dimuat' :
            (filterCategory === 'all' ? 'Belum Ada Karya yang Dikumpulkan' : 'Tidak ada karya untuk filter ini');
          if (description) description.textContent = partial ?
            'Data mungkin belum lengkap. Muat lebih banyak foto atau coba kembali saat cloud tersedia.' :
            'Pilih filter lain atau kumpulkan karya foto ke galeri kelas.';
        }
        return;
      }
      
      if (emptyState) emptyState.classList.add('hidden');
      grid.innerHTML = filtered.map(item => `
        <div data-gallery-card="${escapeHtml(item.id)}" class="bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col justify-between shadow-canva-card hover:shadow-canva transition-all">
          <div class="aspect-video bg-slate-900 relative overflow-hidden group cursor-pointer" onclick="openPhotoPreviewModal('${item.photoUrl}', '${escapeHtml(item.title)}', '${escapeHtml(item.studentName)}', '${escapeHtml(item.studentClass)}', '${escapeHtml(item.shutter || '-')} / ${escapeHtml(item.aperture || '-')} / ${escapeHtml(item.iso || '-')}')">
            <div data-image-placeholder class="absolute inset-0 bg-slate-200 animate-pulse" aria-hidden="true"></div>
            <img loading="lazy" decoding="async" src="${item.photoUrl}" alt="${escapeHtml(item.title)}" 
              onload="finishGalleryImage(this)" onerror="finishGalleryImage(this, true)"
              class="w-full h-full object-cover group-hover:scale-105 opacity-0 transition-[opacity,transform] duration-300">
            <span class="absolute top-2 right-2 text-[9px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-bold shadow-sm">
              Tugas Nyata ✓
            </span>
            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-xs font-mono gap-1">
              <i class="fa-solid fa-magnifying-glass-plus"></i> Klik untuk Zoom
            </div>
          </div>
          <div class="p-4 space-y-2 flex-1 flex flex-col">
            <div>
              <span class="text-[9px] font-mono text-purple-700 font-bold uppercase">${escapeHtml(item.mission)}</span>
              <h4 class="text-xs font-bold text-slate-900 mt-0.5 line-clamp-1">${escapeHtml(item.title)}</h4>
              ${item.notes ? `<p class="text-[11px] text-slate-500 mt-1 line-clamp-2">"${escapeHtml(item.notes)}"</p>` : ''}
            </div>
            
            <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-500 mt-auto">
              <div class="flex items-center gap-1.5 text-slate-800 font-semibold">
                <i class="fa-solid fa-user-pen text-purple-600 text-[9px]"></i>
                <span>${escapeHtml(item.studentName)}</span>
              </div>
              <span class="text-cyan-700 font-bold">${escapeHtml(item.studentClass)}</span>
            </div>
            
            ${(item.shutter || item.aperture || item.iso) ? `
              <div class="bg-slate-50 px-2.5 py-1.5 rounded-xl text-[9px] font-mono text-slate-600 flex justify-between border border-slate-100">
                <span>${escapeHtml(item.shutter || '-')}</span>
                <span>${escapeHtml(item.aperture || '-')}</span>
                <span>${escapeHtml(item.iso || '-')}</span>
              </div>
            ` : ''}
            
            ${item.feedback ? `
              <div class="mt-2 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                <div class="flex items-center gap-1.5 text-[10px] font-mono text-amber-700 font-bold mb-1">
                  <i class="fa-solid fa-comment-dots"></i> Feedback Guru:
                </div>
                <p class="text-[10px] text-amber-800 leading-relaxed">${escapeHtml(item.feedback)}</p>
              </div>
            ` : ''}

            ${item.originalUrl ? `
              <div class="pt-1 text-right">
                <a href="${item.originalUrl}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-mono text-purple-600 font-bold hover:underline inline-flex items-center gap-1">
                  <span>Buka File Asli</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[8px]"></i>
                </a>
              </div>
            ` : ''}
          </div>
        </div>
      `).join('');
    }
    
    let teacherCurrentFilter = 'all';
    let teacherSearchQuery = '';
    
    function renderTeacherTable() {
      const tbody = document.getElementById('teacher-submissions-tbody');
      const emptyState = document.getElementById('teacher-empty-state');
      const list = window.appState?.gallerySubmissions || [];
      const statTotal = document.getElementById('stat-total-submissions');
      const statDkv1 = document.getElementById('stat-count-FILM1');
      const statDkv2 = document.getElementById('stat-count-FILM2');
      if (statTotal) statTotal.innerText = list.length;
      if (statDkv1) statDkv1.innerText = list.filter(i => i.studentClass === 'X FILM 1').length;
      if (statDkv2) statDkv2.innerText = list.filter(i => i.studentClass === 'X FILM 2').length;
      if (!tbody) return;
      const filtered = list.filter(item => {
        const matchClass = teacherCurrentFilter === 'all' || item.studentClass === teacherCurrentFilter;
        const query = teacherSearchQuery.toLowerCase();
        const matchSearch = !query || 
          (item.studentName && item.studentName.toLowerCase().includes(query)) ||
          (item.title && item.title.toLowerCase().includes(query)) ||
          (item.mission && item.mission.toLowerCase().includes(query));
        return matchClass && matchSearch;
      });
      if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
      }
      if (emptyState) emptyState.classList.add('hidden');
      tbody.innerHTML = filtered.map((item, index) => `
        <tr class="hover:bg-purple-50/30 transition-colors">
          <td class="py-3 px-4 font-mono text-slate-400 font-bold">${index + 1}</td>
          <td class="py-3 px-4">
            <div class="w-16 h-12 rounded-xl bg-slate-900 overflow-hidden border border-slate-200 cursor-pointer group relative shadow-xs"
              onclick="openPhotoPreviewModal('${item.photoUrl}', '${escapeHtml(item.title)}', '${escapeHtml(item.studentName)}', '${escapeHtml(item.studentClass)}', '${escapeHtml(item.shutter || '-')} / ${escapeHtml(item.aperture || '-')} / ${escapeHtml(item.iso || '-')}')">
              <img src="${item.photoUrl}" alt="${escapeHtml(item.title)}" onerror="this.src='https://placehold.co/100x75/F1F5F9/7D2AE8?text=Foto'" class="w-full h-full object-cover group-hover:scale-110 transition-transform">
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px]">
                <i class="fa-solid fa-expand"></i>
              </div>
            </div>
          </td>
          <td class="py-3 px-4">
            <div class="font-bold text-slate-900 text-xs">${escapeHtml(item.studentName)}</div>
            <div class="font-mono text-[10px] text-purple-700 font-semibold mt-0.5">${escapeHtml(item.studentClass)} ${item.studentNis ? '• Absen ' + escapeHtml(item.studentNis) : ''}</div>
          </td>
          <td class="py-3 px-4">
            <span class="inline-block px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-mono text-[9px] font-bold border border-purple-200 uppercase">
              ${escapeHtml(item.mission)}
            </span>
            <div class="font-bold text-slate-800 text-xs mt-1">${escapeHtml(item.title)}</div>
          </td>
          <td class="py-3 px-4 font-mono text-[10px] text-slate-600">
            <div><span class="text-slate-400">Speed:</span> ${escapeHtml(item.shutter || '-')}</div>
            <div><span class="text-slate-400">Aperture:</span> ${escapeHtml(item.aperture || '-')}</div>
            <div><span class="text-slate-400">ISO:</span> ${escapeHtml(item.iso || '-')}</div>
          </td>
          <td class="py-3 px-4 text-[11px] text-slate-500 max-w-xs">
            <p class="line-clamp-2">${item.notes ? `"${escapeHtml(item.notes)}"` : '-'}</p>
          </td>
          <td class="py-3 px-4 font-mono text-[10px] text-slate-400 whitespace-nowrap">
            ${escapeHtml(item.submittedAt || (item.timestamp ? new Date(item.timestamp).toLocaleDateString('id-ID') : '-'))}
          </td>
          <td class="py-3 px-4 text-center">
            <div class="flex items-center justify-center gap-1.5 mt-2">
              ${item.originalUrl ? `
                <a href="${item.originalUrl}" target="_blank" rel="noopener noreferrer" title="Buka File Asli" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-cyan-500 hover:text-white text-slate-600 flex items-center justify-center transition-colors">
                  <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                </a>
              ` : ''}
              <button onclick="openTeacherFeedbackModal('${item.id}', '${escapeHtml(item.studentName)}')" title="Beri Umpan Balik" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-amber-500 hover:text-white text-amber-600 flex items-center justify-center transition-colors">
                <i class="fa-solid fa-comment-medical text-xs"></i>
              </button>
              <button onclick="deleteSubmissionTeacher('${item.id}')" title="Hapus Tugas Ini" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-600 hover:text-white text-red-500 flex items-center justify-center transition-colors">
                <i class="fa-solid fa-trash text-xs"></i>
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    }
    
    function filterTeacherTable(filter) {
      teacherCurrentFilter = filter;
      document.querySelectorAll('.teacher-filter-btn').forEach(btn => {
        btn.className = 'teacher-filter-btn px-3.5 py-1.5 rounded-xl bg-slate-50 text-slate-700 border border-slate-200';
      });
      if (event && event.target) {
        event.target.className = 'teacher-filter-btn px-3.5 py-1.5 rounded-xl canva-gradient-bg text-white font-bold shadow-xs';
      }
      renderTeacherTable();
    }
    
    function searchTeacherTable(query) {
      teacherSearchQuery = query;
      renderTeacherTable();
    }
    
    function openTeacherFeedbackModal(submissionId, studentName) {
      const targetId = document.getElementById('feedback-target-id');
      const targetStudent = document.getElementById('feedback-target-student');
      const fbText = document.getElementById('teacher-feedback-text');
      const modal = document.getElementById('modal-teacher-feedback');
      
      if (targetId) targetId.value = submissionId;
      if (targetStudent) targetStudent.innerText = 'Siswa: ' + escapeHtml(studentName);
      
      const list = window.appState?.gallerySubmissions || [];
      const item = list.find(i => i.id === submissionId);
      if (fbText) {
        fbText.value = item && item.feedback ? item.feedback : '';
      }
      
      if (modal) modal.classList.remove('hidden');
    }

    function closeTeacherFeedbackModal() {
      const modal = document.getElementById('modal-teacher-feedback');
      if (modal) modal.classList.add('hidden');
    }

    async function submitTeacherFeedback() {
      const targetId = document.getElementById('feedback-target-id').value;
      const fbText = document.getElementById('teacher-feedback-text').value.trim();
      if (!targetId || !fbText) {
        alertBox('⚠️ Komentar umpan balik tidak boleh kosong.');
        return;
      }
      
      const galleryItem = galleryItems.find(item => item.id === targetId);
      if (galleryItem) galleryItem.feedback = fbText;
      // Update di penyimpanan lokal
      const list = window.appState?.gallerySubmissions || [];
      const item = list.find(i => i.id === targetId);
      if (item) {
        item.feedback = fbText;
        localStorage.setItem('fobi_gallery_submissions', JSON.stringify(list));
      }
      
      // Sinkronisasi dengan Firebase
      if (ENABLE_FIREBASE_ONLINE && db) {
        try {
          await db.collection("gallery").doc(targetId).update({ feedback: fbText });
        } catch (error) {
          console.warn("Gagal sinkron cloud, umpan balik tersimpan lokal:", error);
        }
      }
      
      closeTeacherFeedbackModal();
      renderTeacherTable();
      renderRealStudentGallery(window.currentGalleryFilter || 'all');
      alertBox('Umpan balik berhasil dikirim ke karya siswa!');
    }
    
    async function deleteSubmissionTeacher(subId) {
      galleryItems = galleryItems.filter(item => item.id !== subId);
      const idx = (window.appState?.gallerySubmissions || []).findIndex(i => i.id === subId);
      if (idx > -1) {
        window.appState.gallerySubmissions.splice(idx, 1);
        localStorage.setItem('fobi_gallery_submissions', JSON.stringify(window.appState.gallerySubmissions));
      }
      if (ENABLE_FIREBASE_ONLINE && db) {
        try {
          await db.collection("gallery").doc(subId).delete();
        } catch(e) {}
      }
      renderTeacherTable();
      renderRealStudentGallery(window.currentGalleryFilter || 'all');
      alertBox('Karya foto berhasil dihapus dari galeri.');
    }
    
    async function exportSubmissionsToCSV() {
      if (!await ensureTeacherGallery()) {
        alertBox('Ekspor dibatalkan karena seluruh data tugas belum tersedia.');
        return;
      }
      const list = window.appState?.gallerySubmissions || [];
      if (list.length === 0) {
        alertBox('Belum ada data tugas yang dapat diekspor.');
        return;
      }
      const headers = ["No", "Nama Siswa", "Kelas", "No Absen", "Misi Fotografi", "Judul Karya", "Shutter Speed", "Aperture", "ISO", "Catatan Konsep", "Tautan Asli", "Waktu Unggah"];
      const rows = list.map((item, idx) => [
        idx + 1,
        `"${(item.studentName || '').replace(/"/g, '""')}"`,
        `"${item.studentClass || ''}"`,
        `"${item.studentNis || ''}"`,
        `"${(item.mission || '').replace(/"/g, '""')}"`,
        `"${(item.title || '').replace(/"/g, '""')}"`,
        `"${item.shutter || ''}"`,
        `"${item.aperture || ''}"`,
        `"${item.iso || ''}"`,
        `"${(item.notes || '').replace(/"/g, '""')}"`,
        `"${item.originalUrl || item.photoUrl || ''}"`,
        `"${item.submittedAt || item.timestamp || ''}"`
      ]);
      const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Rekap_Tugas_Fotografi_DKV_SMKN1_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      alertBox('File rekapitulasi CSV berhasil diunduh!');
    }
    
    function exitTeacherMode() {
      switchMainTab('tab-beranda');
      alertBox('Kembali ke tampilan utama.');
    }
    
    function filterGallery(category) {
      window.currentGalleryFilter = category;
      document.querySelectorAll('.gallery-filter-btn').forEach(btn => {
        btn.className = 'gallery-filter-btn px-3 py-1.5 rounded-xl bg-white text-slate-700 border border-slate-200 shadow-xs hover:border-purple-300';
      });
      if (window.event && window.event.target) {
        window.event.target.className = 'gallery-filter-btn px-3 py-1.5 rounded-xl canva-gradient-bg text-white font-bold shadow-xs';
      }
      renderRealStudentGallery(category);
    }
    
    function toggleSidebar() {
      const sidebar = document.getElementById('app-sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar && backdrop && sidebar.classList.contains('-translate-x-full')) {
        sidebar.classList.remove('-translate-x-full');
        backdrop.classList.remove('hidden');
        setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
      } else {
        closeSidebar();
      }
    }

    function closeSidebar() {
      const sidebar = document.getElementById('app-sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar) sidebar.classList.add('-translate-x-full');
      if (backdrop) {
        backdrop.classList.add('opacity-0');
        setTimeout(() => backdrop.classList.add('hidden'), 300);
      }
    }
    
    function escapeHtml(string) {
      if (!string) return '';
      return String(string).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    
    function openAssistantModal() { 
      const m = document.getElementById('modal-assistant');
      if (m) m.classList.remove('hidden'); 
    }
    
    function closeAssistantModal() { 
      const m = document.getElementById('modal-assistant');
      if (m) m.classList.add('hidden'); 
    }
    
    function askFobiQuick(text) {
      const input = document.getElementById('chat-input');
      if (input) input.value = text;
      sendFobiMessage();
    }
    
    function sendFobiMessage() {
      const input = document.getElementById('chat-input');
      const query = input ? input.value.trim() : '';
      if (!query) return;
      const chatBox = document.getElementById('chat-stream-box');
      if (!chatBox) return;
      const userDiv = document.createElement('div');
      userDiv.className = 'bg-purple-50 p-3 rounded-2xl border border-purple-200 text-slate-800 text-right';
      userDiv.innerHTML = `<span class="text-cyan-700 block text-[9px] uppercase font-mono font-bold">${window.appState?.studentProfile?.name || 'Kamu (Siswa)'}</span>${escapeHtml(query)}`;
      chatBox.appendChild(userDiv);
      input.value = '';
      setTimeout(() => {
        let reply = "Perhatikan Segitiga Exposure (ISO, Shutter Speed, Aperture) dan aktifkan grid 3×3 untuk menata komposisi sebelum memotret!";
        const q = query.toLowerCase();
        if (q.includes('gelap')) reply = "Jika ruangan kelas gelap, buka diafragma ke f/2.8, gunakan speed 1/60s, dan naikkan ISO ke 800-1600.";
        else if (q.includes('bokeh')) reply = "Untuk latar bokeh: gunakan bukaan f/1.8 atau f/2.8, dekati objek, dan jauhkan objek dari dinding latar.";
        else if (q.includes('freezing')) reply = "Teknik Freezing butuh shutter speed minimal 1/250s atau lebih cepat (1/500s ke atas). Naikkan ISO jika pencahayaan kurang!";
        else if (q.includes('panning')) reply = "Untuk Panning, gunakan speed 1/30s lalu gerakkan kamera mengikuti pergerakan objek secara stabil.";
        const fobiDiv = document.createElement('div');
        fobiDiv.className = 'bg-slate-50 p-3 rounded-2xl border border-slate-200 text-slate-700';
        fobiDiv.innerHTML = `<strong class="text-purple-700 block mb-0.5 text-[11px]">FOBI:</strong>${reply}`;
        chatBox.appendChild(fobiDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
        playShutterSound();
      }, 350);
    }
    
    function finishCelebration() {
      playShutterSound();
      alertBox('Selamat! Anda telah menyelesaikan seluruh rangkaian Asisten Digital Fotografi.');
    }
    
    function alertBox(msg) {
      const existing = document.getElementById('custom-toast-box');
      if (existing) existing.remove();
      const toast = document.createElement('div');
      toast.id = 'custom-toast-box';
      toast.className = 'fixed bottom-4 right-4 z-50 bg-white border border-purple-300 p-4 rounded-2xl shadow-canva text-xs font-mono text-slate-800 max-w-sm flex items-start gap-2.5';
      toast.innerHTML = `<i class="fa-solid fa-circle-info text-purple-600 mt-0.5"></i><div class="flex-1">${msg}</div><button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-700"><i class="fa-solid fa-xmark"></i></button>`;
      document.body.appendChild(toast);
      setTimeout(() => { if (toast) toast.remove(); }, 5000);
    }
    
    window.onload = function () {
      const savedReflect = localStorage.getItem('fobi_reflection');
      if (savedReflect) {
        try {
          const parsed = JSON.parse(savedReflect);
          const q1 = document.getElementById('ref-q1');
          const q2 = document.getElementById('ref-q2');
          const q3 = document.getElementById('ref-q3');
          const q4 = document.getElementById('ref-q4');
          const q5 = document.getElementById('ref-q5');
          if (q1 && parsed.q1) q1.value = parsed.q1;
          if (q2 && parsed.q2) q2.value = parsed.q2;
          if (q3 && parsed.q3) q3.value = parsed.q3;
          if (q4 && parsed.q4) q4.value = parsed.q4;
          if (q5 && parsed.q5) q5.value = parsed.q5;
          if (parsed.scale) selectReflectScale(parsed.scale);
        } catch(e) {}
      }
      renderStudentIdentityUI();
      window.updateGlobalProgress();
      switchGenreCategory('creative');
      updateCameraSimulator();
      renderRealStudentGallery();
      renderTeacherTable();
      if (!isStudentLoggedIn() && !isTeacherLoggedIn()) {
        setTimeout(() => openLoginModal('student'), 600);
      }
    };
  
