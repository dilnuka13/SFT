let currentInstructor = null;
let html5QrCode = null;
let isProcessingScan = false;

// Populate Paper Selection
const paperSelect = document.getElementById('paper-select');
if (paperSelect) {
    let options = '';
    for (let i = 30; i <= 60; i++) {
        options += `<option value="Black Paper ${i}">Black Paper ${i}</option>`;
    }
    options += `<option value="Special Paper">Special Paper</option>`;
    options += `<option value="Rank Paper">Rank Paper</option>`;
    options += `<option value="Other">Other</option>`;
    paperSelect.innerHTML = options;
}

function toggleNoteField() {
    const val = document.getElementById('paper-select').value;
    const group = document.getElementById('note-group');
    const label = document.getElementById('note-label');
    
    if (val.includes('Special') || val.includes('Rank') || val === 'Other') {
        group.classList.remove('d-none');
        label.innerText = (val === 'Other') ? 'Specify Other Type' : `Note for ${val}`;
    } else {
        group.classList.add('d-none');
        document.getElementById('paper-note').value = '';
    }
}

// Load Instructors for Login
async function loadInstructorsForLogin() {
    // Filter out Admin (You can identify by name or a specific ID if you know it)
    const { data, error } = await supabaseClient.from('instructors').select('*').neq('name', 'Admin Instructor');
    if (error) return;

    const list = document.getElementById('instructor-list');
    list.innerHTML = data.map(inst => `
        <div class="avatar-item" onclick="selectInstructor('${inst.id}', '${inst.name}')" id="inst-${inst.id}">
            <img src="${inst.avatar_url || 'https://via.placeholder.com/60'}" alt="${inst.name}">
            <span>${inst.name.split(' ')[0]}</span>
        </div>
    `).join('');
}

let selectedInstructorId = null;
function selectInstructor(id, name) {
    selectedInstructorId = id;
    document.querySelectorAll('.avatar-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`inst-${id}`).classList.add('active');
    document.getElementById('login-form').classList.remove('d-none');
    document.getElementById('selected-name').innerText = name;
}

async function loginWithPassword() {
    const password = document.getElementById('login-password').value;
    const { data, error } = await supabaseClient.from('instructors').select('*').eq('id', selectedInstructorId).single();
    
    if (error) {
        showToast('Account not found', 'error');
        return;
    }

    if (data.password_hash === password) {
        currentInstructor = data;
        localStorage.setItem('sft_instructor', JSON.stringify(data));
        if (data.temp_password) {
            document.getElementById('force-pass-modal').classList.add('active');
        } else {
            enterDashboard();
        }
    } else {
        showToast('Invalid password', 'error');
    }
}

async function loginWithBiometrics() {
    if (!selectedInstructorId) {
        showToast('Please select your account first.', 'error');
        return;
    }

    if (!window.PublicKeyCredential) {
        showToast('Biometric login is not supported on this device.', 'error');
        return;
    }

    const { data, error } = await supabaseClient
        .from('instructors').select('*').eq('id', selectedInstructorId).single();

    if (error || !data) {
        showToast('Account not found.', 'error');
        return;
    }

    if (!data.webauthn_credential) {
        showToast('No biometric set up for this account. Use password login.', 'error');
        return;
    }

    try {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);

        const rawIdBuffer = base64ToArrayBuffer(data.webauthn_credential.rawId);

        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge,
                allowCredentials: [{ id: rawIdBuffer, type: 'public-key', transports: ['internal'] }],
                userVerification: 'required',
                timeout: 60000
            }
        });

        if (assertion) {
            currentInstructor = data;
            localStorage.setItem('sft_instructor', JSON.stringify(data));
            if (data.temp_password) {
                document.getElementById('force-pass-modal').classList.add('active');
            } else {
                enterDashboard();
            }
        }
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            showToast('Biometric login cancelled or timed out.', 'error');
        } else {
            showToast('Biometric error: ' + err.message, 'error');
        }
    }
}

async function saveNewPassword() {
    const newPass = document.getElementById('force-new-pass').value;
    if (!newPass) return;

    const { error } = await supabaseClient.from('instructors').update({
        password_hash: newPass,
        temp_password: false
    }).eq('id', currentInstructor.id);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Password updated');
        currentInstructor.temp_password = false;
        localStorage.setItem('sft_instructor', JSON.stringify(currentInstructor));
        document.getElementById('force-pass-modal').classList.remove('active');
        enterDashboard();
    }
}

function enterDashboard() {
    document.getElementById('app-container').classList.add('d-none');
    document.getElementById('dashboard-view').classList.remove('d-none');
    document.getElementById('main-nav').classList.remove('d-none');
    document.getElementById('current-user-name').innerText = currentInstructor.name;

    if (currentInstructor.avatar_url) {
        document.getElementById('current-profile-img').src = currentInstructor.avatar_url;
    }

    const baseUrl = window.location.href.split('index.html')[0];
    const studentUrl = `${baseUrl}student.html`;
    document.getElementById('share-link').value = studentUrl;
    generateStudentQR(studentUrl);
    loadPapers(); // loads papers from DB, then populates scanner + export

    // Sync avatar to both PC and mobile headers
    if (currentInstructor.avatar_url) {
        document.getElementById('current-profile-img').src = currentInstructor.avatar_url;
        document.getElementById('pc-user-avatar').src = currentInstructor.avatar_url;
        document.getElementById('mobile-user-avatar').src = currentInstructor.avatar_url;
    }

    // Sync username
    document.getElementById('current-user-name').innerText = currentInstructor.name;
    document.getElementById('pc-user-name').innerText = currentInstructor.name;

    // Remote Scanner Setup (PC Only)
    setupRemoteScanner();
}

function generateStudentQR(url) {
    const qrContainer = document.getElementById('student-qr-display');
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
        text: url,
        width: 180,
        height: 180,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
}

let remoteChannel = null;
function setupRemoteScanner() {
    const qrContainer = document.getElementById('remote-scanner-qr');
    if (!qrContainer) return; // Not on PC/sidebar not present

    // 1. Generate URL
    const baseUrl = window.location.href.split('index.html')[0];
    const remoteUrl = `${baseUrl}remote-scanner.html?id=${currentInstructor.id}`;
    
    // 2. Generate QR
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
        text: remoteUrl,
        width: 100,
        height: 100,
        colorDark: "#000000",
        colorLight: "#ffffff"
    });

    // 3. Setup Realtime
    if (remoteChannel) remoteChannel.unsubscribe();

    remoteChannel = supabaseClient.channel(`scanner:${currentInstructor.id}`, {
        config: { broadcast: { self: false } }
    });

    remoteChannel
        .on('broadcast', { event: 'join' }, (payload) => {
            document.getElementById('remote-status').innerHTML = `<span class="material-symbols-rounded text-[8px] text-m3-primary icon-filled animate-pulse mr-1">circle</span> Phone Connected`;
            showToast("Phone connected for remote scanning!");
            // Send acknowledgement
            remoteChannel.send({ type: 'broadcast', event: 'ping' });
        })
        .on('broadcast', { event: 'scan' }, (payload) => {
            const classId = payload.payload.classId;
            if (classId) {
                // If we are in scanner tab, we might want to show feedback
                // But markAttendance handles its own modals.
                markAttendance(classId);
            }
        })
        .subscribe();
}

// ── QR Card helpers ───────────────────────────────────────
function _loadImg(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload  = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
function _rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);      ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

async function downloadQR() {
    const qrImg = document.querySelector('#student-qr-display img');
    if (!qrImg) { showToast('QR not ready', 'error'); return; }

    const studentUrl = document.getElementById('share-link').value;
    const W = 800, H = 1040;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // ── Background ────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#020617');
    bg.addColorStop(1, '#0a1929');
    _rr(ctx, 0, 0, W, H, 0); ctx.fillStyle = bg; ctx.fill();

    // Green top stripe
    const stripe = ctx.createLinearGradient(0, 0, W, 0);
    stripe.addColorStop(0, '#10b981'); stripe.addColorStop(1, '#059669');
    ctx.fillStyle = stripe; ctx.fillRect(0, 0, W, 7);

    // Subtle top-right glow
    const glow = ctx.createRadialGradient(W, 0, 0, W, 0, 380);
    glow.addColorStop(0, 'rgba(16,185,129,0.12)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // ── Logo ──────────────────────────────────────────────
    try {
        const logo = await _loadImg('logo.png');
        const ls = 72;
        // Soft circle behind logo
        ctx.save();
        ctx.shadowColor = 'rgba(16,185,129,0.35)';
        ctx.shadowBlur  = 24;
        ctx.drawImage(logo, W / 2 - ls / 2, 28, ls, ls);
        ctx.restore();
    } catch(e) { /* skip */ }

    // ── Brand title ───────────────────────────────────────
    ctx.textAlign = 'center';
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 30px Outfit, Arial, sans-serif';
    ctx.fillText('Zeon Opera — Horana', W / 2, 126);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px Outfit, Arial, sans-serif';
    ctx.fillText('SFT Paper Management System', W / 2, 152);

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(60, 170); ctx.lineTo(W - 60, 170); ctx.stroke();

    // ── QR card ───────────────────────────────────────────
    const qrBg = ctx.createLinearGradient(160, 185, 640, 650);
    qrBg.addColorStop(0, 'rgba(16,185,129,0.09)');
    qrBg.addColorStop(1, 'rgba(15,23,42,0.55)');
    ctx.fillStyle = qrBg;
    ctx.strokeStyle = 'rgba(16,185,129,0.28)';
    ctx.lineWidth = 1.5;
    _rr(ctx, 145, 182, 510, 510, 22); ctx.fill(); ctx.stroke();

    // Corner accents (QR card corners)
    const acColor = '#10b981', acLen = 28, acW = 3;
    [[145,182],[655,182],[145,692],[655,692]].forEach(([cx,cy], i) => {
        ctx.strokeStyle = acColor; ctx.lineWidth = acW; ctx.beginPath();
        const sx = i % 2 === 0 ? 1 : -1, sy = i < 2 ? 1 : -1;
        const r = 22;
        if (sx === 1 && sy === 1) {
            ctx.moveTo(cx + r, cy); ctx.lineTo(cx + r + acLen, cy);
            ctx.moveTo(cx, cy + r); ctx.lineTo(cx, cy + r + acLen);
        } else if (sx === -1 && sy === 1) {
            ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r - acLen, cy);
            ctx.moveTo(cx, cy + r); ctx.lineTo(cx, cy + r + acLen);
        } else if (sx === 1 && sy === -1) {
            ctx.moveTo(cx + r, cy); ctx.lineTo(cx + r + acLen, cy);
            ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r - acLen);
        } else {
            ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r - acLen, cy);
            ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r - acLen);
        }
        ctx.stroke();
    });

    // QR image (white background)
    ctx.fillStyle = '#ffffff';
    _rr(ctx, 198, 208, 404, 404, 12); ctx.fill();
    const qr = await _loadImg(qrImg.src);
    ctx.drawImage(qr, 208, 218, 384, 384);

    // ── "SCAN ME" label ───────────────────────────────────
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 17px Outfit, Arial, sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('▲  SCAN ME  ▲', W / 2, 724);
    ctx.letterSpacing = '0px';

    // ── URL pill ──────────────────────────────────────────
    ctx.fillStyle = 'rgba(16,185,129,0.08)';
    ctx.strokeStyle = 'rgba(16,185,129,0.28)'; ctx.lineWidth = 1;
    _rr(ctx, 55, 738, W - 110, 46, 23); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#10b981';
    ctx.font = '500 14px Outfit, "Courier New", monospace';
    const shortUrl = studentUrl.length > 72 ? studentUrl.slice(0, 72) + '…' : studentUrl;
    ctx.fillText('🔗  ' + shortUrl, W / 2, 767);

    // ── Instructions block ────────────────────────────────
    // English main heading
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 19px Outfit, Arial, sans-serif';
    ctx.fillText('How to Register / Update Your Profile', W / 2, 820);

    // Sinhala heading sub
    ctx.fillStyle = 'rgba(148,163,184,0.75)';
    ctx.font = '13px Arial, sans-serif';
    ctx.fillText('ඔබේ SFT ශිෂ්‍ය ගිණුම ලියාපදිංචි / යාවත්කාලීන කරන ආකාරය', W / 2, 842);

    // Step rows
    const steps = [
        { en: '1.  Open your Camera and point at the QR code',   si: 'කැමරාව හරවා QR කේතය frame කරන්න' },
        { en: '2.  Tap the link that appears on your screen',     si: 'තිරයේ ලැබෙන link එකට tap කරන්න' },
        { en: '3.  Enter your Class ID to access your profile',   si: 'Class ID ඇතුළත් කර Profile ලබා ගන්න' },
        { en: '4.  Fill in your details and tap Save',            si: 'තොරතුරු පුරවා Save කරන්න' },
    ];

    let rowY = 873;
    steps.forEach(step => {
        // Row pill
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        _rr(ctx, 55, rowY - 16, W - 110, 38, 10); ctx.fill();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '500 14px Outfit, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(step.en, W / 2, rowY + 4);

        ctx.fillStyle = 'rgba(148,163,184,0.65)';
        ctx.font = '11px Arial, sans-serif';
        ctx.fillText(step.si, W / 2, rowY + 18);

        rowY += 52;
    });

    // ── Footer ────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(60, H - 46); ctx.lineTo(W - 60, H - 46); ctx.stroke();

    ctx.fillStyle = 'rgba(148,163,184,0.35)';
    ctx.font = '12px Outfit, Arial, sans-serif';
    ctx.fillText('malakapriyadarshana.lk  •  Zeon Opera SFT Classes — Horana', W / 2, H - 22);

    // ── Download ──────────────────────────────────────────
    const link = document.createElement('a');
    link.download = 'SFT_Student_Registration_QR.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('QR Card downloaded!');
}

function switchTab(tab) {
    // Update URL hash
    history.replaceState(null, '', '#' + tab);

    // Update PC sidebar links
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    const pcLink = document.getElementById(`pc-link-${tab}`);
    if (pcLink) pcLink.classList.add('active');

    // Update mobile nav items
    document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
    const mobLink = document.getElementById(`mob-link-${tab}`);
    if (mobLink) mobLink.classList.add('active');

    // Hide all sections first
    const sections = ['scanner', 'attendance', 'reports', 'papers', 'profile'];
    sections.forEach(s => {
        const el = document.getElementById(`${s}-section`);
        if (el) el.classList.add('d-none');
    });

    // Show selected section
    const targetEl = document.getElementById(`${tab}-section`);
    if (targetEl) targetEl.classList.remove('d-none');

    // Handle section-specific logic
    if (tab === 'scanner') {
        // no-op, maybe start scanner?
    } else if (tab === 'attendance') {
        loadReports();
        stopScanner();
    } else if (tab === 'reports') {
        stopScanner();
        loadPapers(); // Refresh papers for export grid
    } else if (tab === 'papers') {
        stopScanner();
        loadPapers();
    } else {
        stopScanner();
    }
}

// Scanner Logic
document.getElementById('start-scan-btn')?.addEventListener('click', () => {
    document.getElementById('start-scan-btn').classList.add('d-none');
    document.getElementById('stop-scan-btn').classList.remove('d-none');
    startScanner();
});

document.getElementById('stop-scan-btn')?.addEventListener('click', () => {
    stopScanner();
});

function startScanner() {
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            if (isProcessingScan) return;
            isProcessingScan = true;
            
            // Pause scanner to prevent double scans
            if (html5QrCode && typeof html5QrCode.pause === 'function') {
                try { html5QrCode.pause(); } catch(e) { console.error(e); }
            }
            
            markAttendance(decodedText);
        },
        (errorMessage) => { /* ignore */ }
    ).catch(err => {
        showToast("Camera error: " + err, "error");
        stopScanner();
    });
}

function stopScanner() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            document.getElementById('start-scan-btn').classList.remove('d-none');
            document.getElementById('stop-scan-btn').classList.add('d-none');
            isProcessingScan = false;
        }).catch(err => console.log(err));
    }
}

function processManualId() {
    const id = document.getElementById('manual-id').value;
    if (id) {
        isProcessingScan = true; // Set flag for manual entry too if needed, or just call
        markAttendance(id);
    }
}

async function markAttendance(classId) {
    const paper = document.getElementById('paper-select').value;
    const note = document.getElementById('paper-note').value;
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    try {
        // 1. Check if student exists, if not create
        const { data: student, error: sError } = await supabaseClient.from('students').select('*').eq('class_id', classId).maybeSingle();
        
        let studentObj = student;

        if (!studentObj) {
            // Auto-create student with just Class ID
            const { data: newStudent, error: insertError } = await supabaseClient
                .from('students')
                .insert([{ class_id: classId }])
                .select()
                .single();
            
            if (insertError) {
                showToast(insertError.message, 'error');
                isProcessingScan = false;
                if (html5QrCode && typeof html5QrCode.resume === 'function') {
                    try { html5QrCode.resume(); } catch(e) {}
                }
                return;
            }
            studentObj = newStudent;
        }

        // 2. Duplicate check — Prevent any student from marking the same paper twice
        const { data: existing } = await supabaseClient
            .from('attendance')
            .select('id')
            .eq('class_id', classId)
            .eq('paper_number', paper)
            .limit(1);
        
        if (existing && existing.length > 0) {
            // Show Warning Modal
            document.getElementById('warning-msg').innerText = `ID: ${classId}\n${paper}`;
            document.getElementById('warning-modal').classList.add('active');
            
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            return;
        }

        // 3. Add attendance
        const { error: aError } = await supabaseClient.from('attendance').insert([{
            class_id: classId,
            paper_number: paper,
            note: note || null,
            month: month,
            scanned_by: currentInstructor.id
        }]);

        if (aError) {
            showToast(aError.message, 'error');
            isProcessingScan = false;
            if (html5QrCode && typeof html5QrCode.resume === 'function') {
                try { html5QrCode.resume(); } catch(e) {}
            }
        } else {
            // Show Success Popup with Student Details
            document.getElementById('success-student-name').innerText = `${studentObj.first_name || ''} ${studentObj.last_name || ''}`.trim() || 'New Student (Not Registered)';
            document.getElementById('success-student-id').innerText = classId;
            document.getElementById('success-paper-num').innerText = paper;
            document.getElementById('success-modal').classList.add('active');
            
            // Clear Field
            document.getElementById('manual-id').value = '';
            
            // Auto Close in 5s
            setTimeout(() => {
                closeSuccessModal();
            }, 5000);

            if (navigator.vibrate) navigator.vibrate(200);
        }
    } catch (err) {
        console.error("Attendance marking error:", err);
        showToast("An unexpected error occurred", "error");
        isProcessingScan = false;
        if (html5QrCode && typeof html5QrCode.resume === 'function') {
            try { html5QrCode.resume(); } catch(e) {}
        }
    }
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.remove('active');
    isProcessingScan = false;
    if (html5QrCode && typeof html5QrCode.resume === 'function') {
        try { html5QrCode.resume(); } catch(e) {}
    }
}

function closeWarningModal() {
    document.getElementById('warning-modal').classList.remove('active');
    isProcessingScan = false;
    if (html5QrCode && typeof html5QrCode.resume === 'function') {
        try { html5QrCode.resume(); } catch(e) {}
    }
}

function closeStudentInfoModal() {
    document.getElementById('student-info-modal').classList.remove('active');
    isProcessingScan = false;
    if (html5QrCode && typeof html5QrCode.resume === 'function') {
        try { html5QrCode.resume(); } catch(e) {}
    }
}

async function deleteAttendance(id) {
    if (!confirm('Are you sure you want to delete this attendance record?')) return;

    const { error } = await supabaseClient.from('attendance').delete().eq('id', id);
    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Record deleted');
        loadReports();
    }
}

let editingAttendanceId = null;
async function openEditAttendanceModal(id, classId, paper, note) {
    editingAttendanceId = id;
    document.getElementById('edit-att-id').value = classId;
    document.getElementById('edit-att-note').value = note || '';
    
    // Populate paper select in modal
    const editSelect = document.getElementById('edit-att-paper');
    let papers = _allPapers.filter(p => p.is_active);
    editSelect.innerHTML = papers.map(p =>
        `<option value="${p.paper_number}" ${p.paper_number === paper ? 'selected' : ''}>${p.paper_number}</option>`
    ).join('');

    document.getElementById('edit-attendance-modal').classList.add('active');
}

function closeEditAttendanceModal() {
    document.getElementById('edit-attendance-modal').classList.remove('active');
    editingAttendanceId = null;
}

async function saveEditedAttendance() {
    const newPaper = document.getElementById('edit-att-paper').value;
    const newNote = document.getElementById('edit-att-note').value;

    const { error } = await supabaseClient.from('attendance').update({
        paper_number: newPaper,
        note: newNote || null
    }).eq('id', editingAttendanceId);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Attendance updated');
        closeEditAttendanceModal();
        loadReports();
    }
}

async function requestPasswordReset() {
    if (!selectedInstructorId) return;
    const { error } = await supabaseClient.from('instructors').update({ reset_requested: true }).eq('id', selectedInstructorId);
    if (error) showToast(error.message, 'error');
    else showToast('Reset request sent to admin');
}

function copyShareLink() {
    const copyText = document.getElementById("share-link");
    copyText.select();
    copyText.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(copyText.value);
    showToast('Link copied to clipboard');
}

async function changePassword() {
    const oldPass = document.getElementById('old-pass').value;
    const newPass = document.getElementById('new-pass').value;

    if (currentInstructor.password_hash !== oldPass) {
        showToast('Current password incorrect', 'error');
        return;
    }

    const { error } = await supabaseClient.from('instructors').update({
        password_hash: newPass
    }).eq('id', currentInstructor.id);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Password updated');
        document.getElementById('old-pass').value = '';
        document.getElementById('new-pass').value = '';
    }
}

// ── WebAuthn helpers ──────────────────────────────────────
function arrayBufferToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function setupBiometrics() {
    if (!window.PublicKeyCredential) {
        showToast('Biometric login is not supported on this device.', 'error');
        return;
    }
    if (!window.isSecureContext) {
        showToast('HTTPS is required to use biometric login.', 'error');
        return;
    }

    try {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);

        const credential = await navigator.credentials.create({
            publicKey: {
                challenge,
                rp: { name: 'Zeon Opera SFT', id: location.hostname },
                user: {
                    id: new TextEncoder().encode(currentInstructor.id),
                    name: currentInstructor.name,
                    displayName: currentInstructor.name
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },
                    { type: 'public-key', alg: -257 }
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required'
                },
                timeout: 60000
            }
        });

        const credData = {
            id:    credential.id,
            rawId: arrayBufferToBase64(credential.rawId),
            type:  credential.type
        };

        const { error } = await supabaseClient
            .from('instructors')
            .update({ webauthn_credential: credData })
            .eq('id', currentInstructor.id);

        if (error) {
            showToast('Failed to save biometric: ' + error.message, 'error');
        } else {
            currentInstructor.webauthn_credential = credData;
            localStorage.setItem('sft_instructor', JSON.stringify(currentInstructor));
            showToast('Biometric login set up successfully! ✓');
        }
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            showToast('Biometric setup cancelled.', 'error');
        } else {
            showToast('Setup error: ' + err.message, 'error');
        }
    }
}

async function removeBiometrics() {
    const { error } = await supabaseClient
        .from('instructors')
        .update({ webauthn_credential: null })
        .eq('id', currentInstructor.id);

    if (error) {
        showToast(error.message, 'error');
    } else {
        currentInstructor.webauthn_credential = null;
        localStorage.setItem('sft_instructor', JSON.stringify(currentInstructor));
        showToast('Biometric login removed.');
    }
}

async function uploadAvatar(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const fileExt = file.name.split('.').pop();
    const fileName = `${currentInstructor.id}-${Math.random()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    showToast('Uploading avatar...', 'info');

    // Preview immediately across all avatar elements
    const reader = new FileReader();
    reader.onload = (e) => {
        const src = e.target.result;
        document.getElementById('current-profile-img').src = src;
        document.getElementById('pc-user-avatar').src = src;
        document.getElementById('mobile-user-avatar').src = src;
    };
    reader.readAsDataURL(file);

    const { data, error } = await supabaseClient.storage
        .from('avatars')
        .upload(filePath, file);

    if (error) {
        showToast('Storage error: ' + error.message, 'error');
        return;
    }

    const { data: { publicUrl } } = supabaseClient.storage
        .from('avatars')
        .getPublicUrl(filePath);

    const { error: updateError } = await supabaseClient
        .from('instructors')
        .update({ avatar_url: publicUrl })
        .eq('id', currentInstructor.id);

    if (updateError) {
        showToast(updateError.message, 'error');
    } else {
        showToast('Avatar updated successfully');
        currentInstructor.avatar_url = publicUrl;
        localStorage.setItem('sft_instructor', JSON.stringify(currentInstructor));
    }
}

function logout() {
    localStorage.removeItem('sft_instructor');
    location.reload();
}

// Reports & Export Logic
let _detailedAttendance = [];

async function loadReports() {
    const tbody = document.getElementById('detailed-attendance-table');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="text-center"><span class="material-symbols-rounded animate-spin text-m3-onSurfaceVariant text-lg mr-2 inline-block align-middle">autorenew</span> Loading...</td></tr>';

    const { data, error } = await supabaseClient
        .from('attendance')
        .select(`
            id,
            class_id,
            paper_number,
            note,
            scanned_at,
            scanned_by,
            students (
                first_name,
                last_name
            ),
            instructors (
                name
            )
        `)
        .order('scanned_at', { ascending: false })
        .limit(100);

    if (error) {
        showToast(error.message, 'error');
        return;
    }

    _detailedAttendance = data || [];
    applyFiltersAndSort();
}

function applyFiltersAndSort() {
    const tbody = document.getElementById('detailed-attendance-table');
    const countLabel = document.getElementById('filter-status-count');
    if (!tbody) return;

    const searchVal = document.getElementById('filter-search')?.value.toLowerCase().trim() || '';
    const dateVal = document.getElementById('filter-date')?.value || '';
    const catVal = document.getElementById('filter-category')?.value || 'All';
    const sortVal = document.getElementById('filter-sort')?.value || 'newest';

    // 1. Filtering
    let filtered = _detailedAttendance.filter(row => {
        // Search Match
        const studentName = row.students ? `${row.students.first_name || ''} ${row.students.last_name || ''}`.toLowerCase() : 'not registered';
        const matchSearch = searchVal === '' || 
                            row.class_id.toLowerCase().includes(searchVal) || 
                            studentName.includes(searchVal) || 
                            row.paper_number.toLowerCase().includes(searchVal);

        // Date Match
        let matchDate = true;
        if (dateVal !== '') {
            const scannedDate = new Date(row.scanned_at).toISOString().split('T')[0];
            matchDate = scannedDate === dateVal;
        }

        // Category Match
        let matchCat = true;
        if (catVal !== 'All') {
            const paperObj = _allPapers.find(p => p.paper_number === row.paper_number);
            matchCat = paperObj ? paperObj.category === catVal : (catVal === 'Other');
        }

        return matchSearch && matchDate && matchCat;
    });

    // 2. Sorting
    filtered.sort((a, b) => {
        if (sortVal === 'newest') {
            return new Date(b.scanned_at) - new Date(a.scanned_at);
        } else if (sortVal === 'oldest') {
            return new Date(a.scanned_at) - new Date(b.scanned_at);
        } else if (sortVal === 'name_asc') {
            const nameA = a.students ? `${a.students.first_name || ''} ${a.students.last_name || ''}`.trim().toLowerCase() : 'zzz';
            const nameB = b.students ? `${b.students.first_name || ''} ${b.students.last_name || ''}`.trim().toLowerCase() : 'zzz';
            return nameA.localeCompare(nameB);
        } else if (sortVal === 'name_desc') {
            const nameA = a.students ? `${a.students.first_name || ''} ${a.students.last_name || ''}`.trim().toLowerCase() : 'zzz';
            const nameB = b.students ? `${b.students.first_name || ''} ${b.students.last_name || ''}`.trim().toLowerCase() : 'zzz';
            return nameB.localeCompare(nameA);
        }
        return 0;
    });

    if (countLabel) countLabel.innerText = `Showing ${filtered.length} of ${_detailedAttendance.length} records`;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-m3-onSurfaceVariant py-8"><span class="material-symbols-rounded text-xl block mb-2">filter_alt_off</span>No matching records found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(row => {
        const dt = new Date(row.scanned_at);
        const dateStr = dt.toLocaleDateString('si-LK', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        const instructorName = row.instructors?.name || '—';
        return `
        <tr>
            <td style="font-weight: 600; color: var(--md-sys-color-primary);">${row.class_id}</td>
            <td>${row.students ? `${row.students.first_name || ''} ${row.students.last_name || ''}`.trim() || '<span class="text-muted">—</span>' : '<span class="text-muted text-xs bg-m3-error/10 border border-m3-error/20 px-2 py-0.5 rounded text-m3-error">Not Registered</span>'}</td>
            <td><span class="badge badge-success" style="font-size: 10px;">${row.paper_number}</span></td>
            <td style="font-size: 11px;">
                <div style="color: var(--md-sys-color-on-background); font-weight: 500;">${dateStr}</div>
                <div style="color: var(--md-sys-color-on-surface-variant); font-size: 10px;">${timeStr}</div>
            </td>
            <td class="hidden sm:table-cell" style="font-size: 11px;">
                <div style="display:flex; align-items:center; gap:5px;">
                    <span class="material-symbols-rounded text-m3-primary text-sm">record_voice_over</span>
                    <span>${instructorName}</span>
                </div>
            </td>
            <td>
                <div style="display: flex; gap: 5px; justify-content: flex-end;">
                    <button class="m3-btn m3-btn-tonal !h-8 !px-3 rounded-lg" onclick="openEditAttendanceModal('${row.id}', '${row.class_id}', '${row.paper_number}', '${row.note || ''}')">
                        <span class="material-symbols-rounded text-sm">edit</span>
                    </button>
                    <button class="m3-btn !bg-m3-error/10 text-m3-error hover:!bg-m3-error hover:!text-white !h-8 !px-3 rounded-lg border border-m3-error/20" onclick="deleteAttendance('${row.id}')">
                        <span class="material-symbols-rounded text-sm">delete</span>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function resetFilters() {
    const search = document.getElementById('filter-search');
    const date = document.getElementById('filter-date');
    const category = document.getElementById('filter-category');
    const sort = document.getElementById('filter-sort');

    if (search) search.value = '';
    if (date) date.value = '';
    if (category) category.value = 'All';
    if (sort) sort.value = 'newest';

    applyFiltersAndSort();
}

async function populatePaperSelect() {
    const sel = document.getElementById('paper-select');
    if (!sel) return;

    let papers = _allPapers.filter(p => p.is_active);
    if (papers.length === 0) {
        // Fallback: load from DB if not yet loaded
        const { data } = await supabaseClient.from('papers').select('*').eq('is_active', true).order('sort_order');
        papers = data || [];
    }

    sel.innerHTML = papers.map(p =>
        `<option value="${p.paper_number}">${p.paper_number}${p.unique_code ? ' (' + p.unique_code + ')' : ''}</option>`
    ).join('');
    toggleNoteField();
}

async function populateExportPapers() {
    const grid = document.getElementById('export-paper-grid');
    if (!grid) return;

    let papers = _allPapers.filter(p => p.is_active);
    if (papers.length === 0) {
        const { data } = await supabaseClient.from('papers').select('*').eq('is_active', true).order('sort_order');
        papers = data || [];
    }

    grid.innerHTML = papers.map(p => `
        <label class="paper-landscape-card flex border border-m3-outline/10 hover:border-m3-primary/30 rounded-2xl overflow-hidden cursor-pointer relative transition-all" id="export-card-${p.id}">
            <!-- Hidden checkbox -->
            <input type="checkbox" class="paper-checkbox hidden" value="${p.paper_number}" onchange="togglePaperCard('${p.id}', this.checked)">
            
            <!-- Left division: Thumbnail (Document preview representation) -->
            <div class="w-1/3 bg-m3-surfaceVariant/30 flex flex-col items-center justify-center border-r border-m3-outline/10 p-2 text-center select-none relative">
                <span class="material-symbols-rounded text-3xl text-m3-primary mb-1">description</span>
                <span class="text-[9px] font-bold tracking-wider text-m3-onSurfaceVariant uppercase truncate max-w-full">${p.category}</span>
                
                <!-- Active visual indicator overlay when checked -->
                <div class="active-indicator absolute inset-0 bg-m3-primaryContainer/20 flex items-center justify-center opacity-0 transition-opacity pointer-events-none">
                    <span class="material-symbols-rounded text-4xl text-m3-primary icon-filled">check_circle</span>
                </div>
            </div>
            
            <!-- Right division: Details -->
            <div class="w-2/3 p-3 flex flex-col justify-between relative">
                <!-- Checklist status / quick details info icon -->
                <button type="button" class="absolute top-2 right-2 text-m3-onSurfaceVariant hover:text-m3-primary transition-colors h-7 w-7 rounded-full hover:bg-m3-surfaceVariant/50 flex items-center justify-center" onclick="event.stopPropagation(); viewPaperQuickDetails('${p.paper_number.replace(/'/g, "\\'")}', '${p.unique_code || ''}', '${p.category}')">
                    <span class="material-symbols-rounded text-lg">info</span>
                </button>

                <div class="pr-6">
                    <h4 class="font-bold text-xs text-m3-onSurface leading-tight truncate" title="${p.paper_number}">${p.paper_number}</h4>
                    <p class="text-[10px] text-m3-onSurfaceVariant mt-1">Code: <span class="font-mono text-m3-primary">${p.unique_code || '—'}</span></p>
                    <p class="text-[9px] text-m3-onSurfaceVariant mt-0.5">Order: ${p.sort_order}</p>
                </div>
                
                <div class="flex items-center justify-between mt-2 pt-2 border-t border-m3-outline/5 text-[9px] text-m3-onSurfaceVariant">
                    <span>Click to Select</span>
                    <span class="flex items-center gap-1 font-bold select-state text-m3-onSurfaceVariant">
                        <span class="material-symbols-rounded text-xs">check_box_outline_blank</span>
                    </span>
                </div>
            </div>
        </label>
    `).join('');
}

function selectAllPapers(checked) {
    document.querySelectorAll('.paper-checkbox').forEach(cb => {
        cb.checked = checked;
        const label = cb.closest('label');
        if (label) {
            const id = label.id.replace('export-card-', '');
            togglePaperCard(id, checked);
        }
    });
}

function getImageBase64(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = url;
    });
}

async function generatePDF() {
    const month = document.getElementById('export-month').value;
    const selectedPapers = Array.from(document.querySelectorAll('.paper-checkbox:checked')).map(cb => cb.value);

    if (selectedPapers.length === 0) {
        showToast('Please select at least one paper', 'error');
        return;
    }

    showToast('Generating PDF...', 'info');

    let query = supabaseClient
        .from('attendance')
        .select(`
            class_id,
            paper_number,
            students (
                first_name,
                last_name,
                email
            )
        `)
        .in('paper_number', selectedPapers);

    if (month) {
        query = query.eq('month', month);
    }

    const { data, error } = await query;

    if (error) {
        showToast(error.message, 'error');
        return;
    }

    const studentsMap = {};
    data.forEach(item => {
        if (item.students) {
            if (!studentsMap[item.class_id]) {
                studentsMap[item.class_id] = {
                    name: `${item.students.first_name || ''} ${item.students.last_name || ''}`,
                    email: item.students.email || '-',
                    papers: {}
                };
            }
            studentsMap[item.class_id].papers[item.paper_number] = true;
        }
    });

    const studentList = Object.keys(studentsMap).map(id => ({
        id,
        ...studentsMap[id]
    }));

    if (studentList.length === 0) {
        showToast('No records found for selection', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4'); 
    
    try {
        const logoBase64 = await getImageBase64('MiniLogo.png');
        doc.addImage(logoBase64, 'PNG', 14, 4, 8, 16); // Preserved 1:2 aspect ratio (8mm width, 16mm height)
    } catch (e) {
        console.error('Logo failed to load', e);
    }

    // Modern vertical accent line in M3 primary green [128, 220, 160]
    doc.setDrawColor(128, 220, 160);
    doc.setLineWidth(1.2);
    doc.line(26, 4, 26, 20);

    // Title & Brand Info
    doc.setTextColor(25, 28, 25); // Sleek M3 dark charcoal text
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Attendance & Marking Checklist", 30, 9);
    
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 82, 46); // Dark Green M3 Primary Container color
    doc.setFontSize(9);
    doc.text("Zeon Opera SFT - Horana Branch | Malaka Priyadarshana Sir", 30, 14);

    doc.setTextColor(110, 115, 110); // M3 muted grey text
    doc.setFontSize(8);
    doc.text(`Generated on: ${new Date().toLocaleString()} ${month ? `| Month: ${month}` : ''}`, 30, 19);

    const head = [['ID', 'Name', 'Email', ...selectedPapers]];
    const body = studentList.map(s => {
        const row = [s.id, s.name, s.email];
        selectedPapers.forEach(paper => {
            row.push(s.papers[paper] ? 1 : '');
        });
        return row;
    });

    doc.autoTable({
        head: head,
        body: body,
        startY: 25,
        theme: 'grid',
        styles: { 
            fontSize: 8, 
            cellPadding: 2.5, 
            halign: 'center', 
            valign: 'middle',
            font: 'helvetica',
            textColor: [40, 45, 40],
            borderColor: [225, 230, 225] // Subtle green-grey outline border
        },
        columnStyles: {
            0: { halign: 'left', cellWidth: 20, fontStyle: 'bold' },
            1: { halign: 'left', cellWidth: 35 },
            2: { halign: 'left', cellWidth: 40 }
        },
        headStyles: { 
            fillColor: [0, 82, 46], // Dark green M3 primary container
            textColor: [255, 255, 255], 
            fontStyle: 'bold',
            fontSize: 8.5,
            borderColor: [0, 82, 46]
        },
        alternateRowStyles: {
            fillColor: [245, 250, 246] // Alternating light green-tinted background rows
        },
        didParseCell: function(data) {
            // Hide the numeric marker — graphic drawn in didDrawCell
            if (data.section === 'body' && data.column.index >= 3 && data.cell.raw === 1) {
                data.cell.text = [''];
            }
        },
        didDrawCell: function(data) {
            if (data.section === 'body' && data.column.index >= 3 && data.row.raw[data.column.index] === 1) {
                const doc  = data.doc;
                const cx   = data.cell.x + data.cell.width  / 2;
                const cy   = data.cell.y + data.cell.height / 2;
                const r    = 3.2;

                // Circle in M3 Primary Green
                doc.setFillColor(128, 220, 160);
                doc.circle(cx, cy, r, 'F');

                // Contrast dark-green checkmark lines
                doc.setDrawColor(0, 57, 30);
                doc.setLineWidth(0.8);
                // Short left stroke of tick
                doc.line(cx - 1.6, cy,       cx - 0.4, cy + 1.4);
                // Long right stroke of tick
                doc.line(cx - 0.4, cy + 1.4, cx + 2.0, cy - 1.2);
            }
        }
    });

    doc.save(`Marking_Checklist_${Date.now()}.pdf`);
    showToast('Attendance checklist exported!');
}

// ── Paper Management ──────────────────────────────────────
let _allPapers = [];

async function loadPapers() {
    const loadingEl  = document.getElementById('papers-loading');
    const wrapEl     = document.getElementById('papers-table-wrap');
    if (loadingEl) loadingEl.classList.remove('d-none');
    if (wrapEl)    wrapEl.classList.add('d-none');

    const { data, error } = await supabaseClient
        .from('papers')
        .select('*')
        .order('sort_order', { ascending: true });

    if (error) { showToast(error.message, 'error'); return; }
    _allPapers = data;
    
    // Generate quick category count selector chips dynamically
    generateCategoryChips();

    if (loadingEl) loadingEl.classList.add('d-none');
    if (wrapEl)    wrapEl.classList.remove('d-none');

    const tbody = document.getElementById('papers-list');
    if (tbody) {
        tbody.innerHTML = data.map((p, i) => `
            <tr style="opacity: ${p.is_active ? 1 : 0.45};">
                <td class="hidden sm:table-cell" style="color:var(--text-muted);">${i + 1}</td>
                <td style="font-weight:600;">${p.paper_number}</td>
                <td><span class="badge" style="background:rgba(16,185,129,0.1); color:var(--primary-color); font-size:10px;">${p.category}</span></td>
                <td class="hidden sm:table-cell" style="color:var(--text-muted); font-size:11px;">${p.unique_code || '—'}</td>
                <td>
                    <label style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px;">
                        <input type="checkbox" ${p.is_active ? 'checked' : ''}
                            onchange="togglePaperStatus('${p.id}', this.checked)"
                            style="accent-color:var(--primary-color); width:14px; height:14px;">
                        ${p.is_active ? 'Active' : 'Inactive'}
                    </label>
                </td>
                <td>
                    <button class="m3-btn !bg-m3-error/10 text-m3-error hover:!bg-m3-error hover:!text-white !h-8 !w-8 !p-0 rounded-full flex items-center justify-center border border-m3-error/20"
                        onclick="deletePaper('${p.id}', \`${p.paper_number.replace(/`/g, '\\`')}\`)">
                        <span class="material-symbols-rounded text-sm">delete</span>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // Refresh scanner dropdown and export grid
    populatePaperSelect();
    populateExportPapers();
}

async function addPaper() {
    const category = document.getElementById('new-paper-category').value.trim();
    const number   = document.getElementById('new-paper-number').value.trim();
    const code     = document.getElementById('new-paper-code').value.trim();
    let sort       = parseInt(document.getElementById('new-paper-sort').value);

    if (isNaN(sort) || sort === 100) {
        // Fallback: extract digits from paper name/title (e.g. "Black Paper 61" -> 61)
        const match = number.match(/\d+/);
        sort = match ? parseInt(match[0]) : 100;
    }

    if (!category || !number) {
        showToast('Category and Paper Name are required.', 'error');
        return;
    }

    const { error } = await supabaseClient.from('papers').insert([{
        category,
        paper_number: number,
        unique_code:  code || null,
        sort_order:   sort,
        is_active:    true
    }]);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Paper added successfully!');
        closeAddPaperModal();
        loadPapers();
    }
}

async function deletePaper(id, name) {
    if (!confirm(`Delete "${name}"?\n(Existing attendance records are not affected.)`)) return;
    const { error } = await supabaseClient.from('papers').delete().eq('id', id);
    if (error) showToast(error.message, 'error');
    else { showToast('Paper removed.'); loadPapers(); }
}

async function togglePaperStatus(id, isActive) {
    const { error } = await supabaseClient.from('papers').update({ is_active: isActive }).eq('id', id);
    if (error) showToast(error.message, 'error');
    else loadPapers();
}

// Helper to get next paper number in a category based on existing papers in _allPapers
function getNextPaperNumber(category) {
    let maxNum = 0;
    if (_allPapers && _allPapers.length > 0) {
        _allPapers.forEach(p => {
            if (p.category && p.category.toLowerCase() === category.toLowerCase()) {
                // Extract numerical digits using regex (e.g. from "Black Paper 61" -> 61)
                const match = p.paper_number.match(/\d+/);
                if (match) {
                    const num = parseInt(match[0]);
                    if (num > maxNum) {
                        maxNum = num;
                    }
                }
            }
        });
    }
    return maxNum + 1;
}

// Global variables to track selected category values
let selectedCategoryValue = '';
let selectedShortCodePrefix = '';

function selectQuickCategory(categoryVal, shortCodePrefix) {
    selectedCategoryValue = categoryVal;
    selectedShortCodePrefix = shortCodePrefix;

    // Highlight active chip
    const chips = document.querySelectorAll('.category-chip');
    chips.forEach(chip => {
        if (chip.innerText.trim() === categoryVal || (categoryVal === 'Other' && chip.innerText.trim() === 'Other')) {
            chip.classList.add('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer', 'border-m3-primary');
            chip.classList.remove('border-m3-outline/30');
        } else {
            chip.classList.remove('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer', 'border-m3-primary');
            chip.classList.add('border-m3-outline/30');
        }
    });

    const customCategoryGroup = document.getElementById('custom-category-group');
    const categoryInput = document.getElementById('new-paper-category');
    
    if (categoryVal === 'Other') {
        if (customCategoryGroup) customCategoryGroup.classList.remove('d-none');
        if (categoryInput) {
            categoryInput.value = '';
            categoryInput.focus();
        }
        
        // Let user fill in everything manually
        document.getElementById('new-paper-number').value = '';
        document.getElementById('new-paper-code').value = '';
    } else {
        if (customCategoryGroup) customCategoryGroup.classList.add('d-none');
        if (categoryInput) categoryInput.value = categoryVal;
        
        // Auto-increment and auto-populate
        const nextNum = getNextPaperNumber(categoryVal);
        
        // Title: "<Category> <Next Number>"
        document.getElementById('new-paper-number').value = `${categoryVal} ${nextNum}`;
        
        // Code: "<Prefix><Next Number>"
        document.getElementById('new-paper-code').value = `${shortCodePrefix}${nextNum}`;

        // Sort Order Priority: "<Next Number>"
        document.getElementById('new-paper-sort').value = nextNum;
    }
}

function openAddPaperModal() {
    document.getElementById('new-paper-category').value = '';
    document.getElementById('new-paper-number').value   = '';
    document.getElementById('new-paper-code').value     = '';
    document.getElementById('new-paper-sort').value     = '100';
    
    // Reset quick category chips
    document.querySelectorAll('.category-chip').forEach(chip => {
        chip.classList.remove('bg-m3-primaryContainer', 'text-m3-onPrimaryContainer', 'border-m3-primary');
        chip.classList.add('border-m3-outline/30');
    });
    
    const customGroup = document.getElementById('custom-category-group');
    if (customGroup) customGroup.classList.add('d-none');
    
    document.getElementById('add-paper-modal').classList.add('active');
}

function closeAddPaperModal() {
    document.getElementById('add-paper-modal').classList.remove('active');
}

// Auto-login Check
window.addEventListener('load', () => {
    loadInstructorsForLogin();
    const saved = localStorage.getItem('sft_instructor');
    if (saved) {
        currentInstructor = JSON.parse(saved);
        enterDashboard();
        // Restore tab from URL hash
        const validTabs = ['scanner', 'attendance', 'reports', 'papers', 'profile'];
        const hash = window.location.hash.replace('#', '');
        if (validTabs.includes(hash)) switchTab(hash);
    }

    // Auto-update Sort Order Priority when typing the paper title manually
    document.getElementById('new-paper-number')?.addEventListener('input', (e) => {
        const match = e.target.value.match(/\d+/);
        if (match) {
            document.getElementById('new-paper-sort').value = match[0];
        }
    });
});

/* ==========================================================================
   PREMIUM PORTAL INTERACTION FUNCTIONS (Drawer, Chips, Landscape Cards)
   ========================================================================== */

/**
 * Dynamically scans active papers to generate quick category count chips.
 */
function generateCategoryChips() {
    const chipContainer = document.getElementById('quick-category-chips');
    if (!chipContainer) return;

    // Get active papers
    const activePapers = _allPapers.filter(p => p.is_active);

    // Count papers per category
    const counts = {};
    activePapers.forEach(p => {
        const cat = p.category || 'Other';
        counts[cat] = (counts[cat] || 0) + 1;
    });

    // Default categories in desired order
    const defaultCategories = [
        'Black Paper',
        'Wave Paper',
        'Full Paper',
        'Special Paper',
        'Ranking Paper',
        'Physics',
        'Chemistry',
        'Combined Maths',
        'ICT'
    ];

    const categoriesToShow = [];
    
    // Map default ones first
    defaultCategories.forEach(cat => {
        if (counts[cat] > 0) {
            categoriesToShow.push({ name: cat, count: counts[cat] });
        }
    });

    // Map any custom ones
    Object.keys(counts).forEach(cat => {
        if (!defaultCategories.includes(cat)) {
            categoriesToShow.push({ name: cat, count: counts[cat] });
        }
    });

    if (categoriesToShow.length === 0) {
        chipContainer.innerHTML = '<span class="text-xs text-m3-onSurfaceVariant py-2">No active papers found.</span>';
        return;
    }

    chipContainer.innerHTML = categoriesToShow.map(c => `
        <div class="category-select-chip ripple-target" onclick="openCategoryDrawer('${c.name.replace(/'/g, "\\'")}')">
            <span class="material-symbols-rounded text-sm text-m3-primary">bookmark</span>
            <span>${c.name}</span>
            <span class="text-xs bg-m3-primaryContainer/30 text-m3-primary px-1.5 py-0.5 rounded-full font-bold">${c.count}</span>
        </div>
    `).join('');
}

let _currentDrawerCategory = '';

/**
 * Opens slide-up bottom drawer overlay showing category papers.
 */
function openCategoryDrawer(category) {
    _currentDrawerCategory = category;
    const drawer = document.getElementById('category-papers-drawer');
    const title = document.getElementById('drawer-category-title');
    const searchInput = document.getElementById('drawer-search-input');

    if (title) title.innerHTML = `<span class="material-symbols-rounded text-m3-primary">bookmark</span> ${category}`;
    if (searchInput) searchInput.value = '';

    if (drawer) {
        drawer.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    renderCategoryDrawerPapers(category);
}

/**
 * Closes the slide-up bottom drawer.
 */
function closeCategoryDrawer(event) {
    if (event && event.target !== document.getElementById('category-papers-drawer')) {
        return;
    }
    const drawer = document.getElementById('category-papers-drawer');
    if (drawer) {
        drawer.classList.remove('active');
        document.body.style.overflow = '';
    }
}

/**
 * Renders papers inside the category drawer.
 */
function renderCategoryDrawerPapers(category, filterText = '') {
    const listContainer = document.getElementById('drawer-papers-list');
    const countLabel = document.getElementById('drawer-category-count');
    if (!listContainer) return;

    const query = filterText.toLowerCase().trim();

    let papers = _allPapers.filter(p => p.category === category && p.is_active);

    if (query !== '') {
        papers = papers.filter(p => 
            p.paper_number.toLowerCase().includes(query) || 
            (p.unique_code && p.unique_code.toLowerCase().includes(query))
        );
    }

    if (countLabel) countLabel.innerText = `${papers.length} Paper${papers.length !== 1 ? 's' : ''}`;

    if (papers.length === 0) {
        listContainer.innerHTML = `
            <div class="text-center py-8 text-m3-onSurfaceVariant">
                <span class="material-symbols-rounded text-3xl block mb-2">find_in_page</span>
                No papers found matching your search.
            </div>`;
        return;
    }

    listContainer.innerHTML = papers.map(p => `
        <div class="drawer-paper-row flex items-center justify-between gap-3 mb-2">
            <div class="flex flex-col">
                <span class="font-bold text-m3-onSurface text-sm">${p.paper_number}</span>
                <span class="text-xs text-m3-onSurfaceVariant font-mono">${p.unique_code || 'No Code'} • Order: ${p.sort_order}</span>
            </div>
            <button class="m3-btn m3-btn-tonal !h-8 !px-3 rounded-lg flex items-center justify-center gap-1" onclick="viewPaperQuickDetails('${p.paper_number.replace(/'/g, "\\'")}', '${p.unique_code || ''}', '${p.category}')">
                <span class="material-symbols-rounded text-sm">info</span>
                <span>Details</span>
            </button>
        </div>
    `).join('');
}

/**
 * Handles drawer searching/filtering of papers.
 */
function filterDrawerPapers() {
    const searchVal = document.getElementById('drawer-search-input')?.value || '';
    renderCategoryDrawerPapers(_currentDrawerCategory, searchVal);
}

/**
 * Toggles landscape card select state visually.
 */
function togglePaperCard(id, checked) {
    const card = document.getElementById(`export-card-${id}`);
    if (!card) return;

    const indicator = card.querySelector('.active-indicator');
    const selectState = card.querySelector('.select-state');

    if (checked) {
        card.classList.add('bg-m3-primaryContainer/15', 'border-m3-primary/60', 'shadow-[0_0_15px_rgba(128,220,160,0.15)]');
        card.classList.remove('border-m3-outline/10');
        if (indicator) indicator.classList.remove('opacity-0');
        if (selectState) {
            selectState.innerHTML = '<span class="material-symbols-rounded text-xs text-m3-primary icon-filled">check_box</span> Selected';
            selectState.classList.add('text-m3-primary');
            selectState.classList.remove('text-m3-onSurfaceVariant');
        }
    } else {
        card.classList.remove('bg-m3-primaryContainer/15', 'border-m3-primary/60', 'shadow-[0_0_15px_rgba(128,220,160,0.15)]');
        card.classList.add('border-m3-outline/10');
        if (indicator) indicator.classList.add('opacity-0');
        if (selectState) {
            selectState.innerHTML = '<span class="material-symbols-rounded text-xs">check_box_outline_blank</span>';
            selectState.classList.remove('text-m3-primary');
            selectState.classList.add('text-m3-onSurfaceVariant');
        }
    }
}

/**
 * Displays quick details about a paper as a premium toast message.
 */
function viewPaperQuickDetails(name, code, category) {
    showToast(`Paper: ${name} | Category: ${category} | Code: ${code || 'None'}`, 'success');
}

// Automatically blur and hide the mobile virtual keyboard when clicking/tapping outside of manual-id input
document.addEventListener('touchstart', function(event) {
    const manualIdInput = document.getElementById('manual-id');
    if (!manualIdInput) return;
    
    if (document.activeElement === manualIdInput) {
        const isClickInside = manualIdInput.contains(event.target) || 
                              event.target.closest('.m3-btn') || 
                              event.target.closest('.m3-input-group');
        
        if (!isClickInside) {
            manualIdInput.blur();
        }
    }
});

document.addEventListener('mousedown', function(event) {
    const manualIdInput = document.getElementById('manual-id');
    if (!manualIdInput) return;
    
    if (document.activeElement === manualIdInput) {
        const isClickInside = manualIdInput.contains(event.target) || 
                              event.target.closest('.m3-btn') || 
                              event.target.closest('.m3-input-group');
        
        if (!isClickInside) {
            manualIdInput.blur();
        }
    }
});
