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
            document.getElementById('remote-status').innerHTML = `<i class='bx bxs-circle' style='color:var(--primary-color); font-size:8px;'></i> Phone Connected`;
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
async function loadReports() {
    const tbody = document.getElementById('detailed-attendance-table');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="text-center"><i class="bx bx-loader-alt bx-spin"></i> Loading...</td></tr>';

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

    tbody.innerHTML = data.map(row => {
        const dt = new Date(row.scanned_at);
        const dateStr = dt.toLocaleDateString('si-LK', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        const instructorName = row.instructors?.name || '—';
        return `
        <tr>
            <td style="font-weight: 600; color: var(--primary-color);">${row.class_id}</td>
            <td>${row.students ? `${row.students.first_name || ''} ${row.students.last_name || ''}`.trim() || '<span class="text-muted">—</span>' : '<span class="text-muted">Not Registered</span>'}</td>
            <td><span class="badge badge-success" style="font-size: 10px;">${row.paper_number}</span></td>
            <td style="font-size: 11px;">
                <div style="color: var(--text-color); font-weight: 500;">${dateStr}</div>
                <div style="color: var(--text-muted); font-size: 10px;">${timeStr}</div>
            </td>
            <td style="font-size: 11px;">
                <div style="display:flex; align-items:center; gap:5px;">
                    <i class='bx bx-user-voice' style="color:var(--primary-color); font-size:13px;"></i>
                    <span>${instructorName}</span>
                </div>
            </td>
            <td>
                <div style="display: flex; gap: 5px;">
                    <button class="btn btn-primary" style="padding: 4px 8px; font-size: 12px;" onclick="openEditAttendanceModal('${row.id}', '${row.class_id}', '${row.paper_number}', '${row.note || ''}')">
                        <i class='bx bx-edit'></i>
                    </button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 12px;" onclick="deleteAttendance('${row.id}')">
                        <i class='bx bx-trash'></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
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
        <label class="glass" style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer;">
            <input type="checkbox" class="paper-checkbox" value="${p.paper_number}"
                style="width: 16px; height: 16px; accent-color: var(--primary-color);">
            <span style="font-size: 11px;">${p.paper_number}</span>
        </label>
    `).join('');
}

function selectAllPapers(checked) {
    document.querySelectorAll('.paper-checkbox').forEach(cb => cb.checked = checked);
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
        doc.addImage(logoBase64, 'PNG', 14, 4, 16, 16);
    } catch (e) {
        console.error('Logo failed to load', e);
    }

    doc.setFontSize(18);
    doc.text("Attendance & Marking Checklist", 50, 15);
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()} ${month ? `| Month: ${month}` : ''}`, 50, 22);

    const head = [['ID', 'Name', 'Email', ...selectedPapers]];
    const body = studentList.map(s => {
        const row = [s.id, s.name, s.email];
        selectedPapers.forEach(paper => {
            // Use 1 as a marker (text hidden; drawn via didDrawCell)
            row.push(s.papers[paper] ? 1 : '');
        });
        return row;
    });

    doc.autoTable({
        head: head,
        body: body,
        startY: 30,
        theme: 'grid',
        styles: { 
            fontSize: 8, 
            cellPadding: 2, 
            halign: 'center', 
            valign: 'middle' 
        },
        columnStyles: {
            0: { halign: 'left', cellWidth: 20 },
            1: { halign: 'left', cellWidth: 35 },
            2: { halign: 'left', cellWidth: 40 }
        },
        headStyles: { fillColor: [16, 185, 129], textColor: 255 },
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

                // Green filled circle
                doc.setFillColor(16, 185, 129);
                doc.circle(cx, cy, r, 'F');

                // White checkmark lines
                doc.setDrawColor(255, 255, 255);
                doc.setLineWidth(0.7);
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
    if (loadingEl) loadingEl.style.display = 'block';
    if (wrapEl)    wrapEl.style.display = 'none';

    const { data, error } = await supabaseClient
        .from('papers')
        .select('*')
        .order('sort_order', { ascending: true });

    if (error) { showToast(error.message, 'error'); return; }
    _allPapers = data;

    if (loadingEl) loadingEl.style.display = 'none';
    if (wrapEl)    wrapEl.style.display = 'block';

    const tbody = document.getElementById('papers-list');
    if (tbody) {
        tbody.innerHTML = data.map((p, i) => `
            <tr style="opacity: ${p.is_active ? 1 : 0.45};">
                <td style="color:var(--text-muted);">${i + 1}</td>
                <td style="font-weight:600;">${p.paper_number}</td>
                <td><span class="badge" style="background:rgba(16,185,129,0.1); color:var(--primary-color); font-size:10px;">${p.category}</span></td>
                <td style="color:var(--text-muted); font-size:11px;">${p.unique_code || '—'}</td>
                <td>
                    <label style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px;">
                        <input type="checkbox" ${p.is_active ? 'checked' : ''}
                            onchange="togglePaperStatus('${p.id}', this.checked)"
                            style="accent-color:var(--primary-color); width:14px; height:14px;">
                        ${p.is_active ? 'Active' : 'Inactive'}
                    </label>
                </td>
                <td>
                    <button class="btn btn-danger" style="padding:4px 8px; font-size:11px;"
                        onclick="deletePaper('${p.id}', \`${p.paper_number.replace(/`/g, '\\`')}\`)">
                        <i class='bx bx-trash'></i>
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
    const sort     = parseInt(document.getElementById('new-paper-sort').value) || 100;

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

function openAddPaperModal() {
    document.getElementById('new-paper-category').value = '';
    document.getElementById('new-paper-number').value   = '';
    document.getElementById('new-paper-code').value     = '';
    document.getElementById('new-paper-sort').value     = '100';
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
        const validTabs = ['scanner', 'reports', 'profile'];
        const hash = window.location.hash.replace('#', '');
        if (validTabs.includes(hash)) switchTab(hash);
    }
});
