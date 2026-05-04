let currentStudent = null;
let regScanner = null;
let _confirmCallback = null;

// Custom bilingual confirm dialog
function showConfirm() {
    return new Promise(resolve => {
        _confirmCallback = resolve;
        const modal = document.getElementById('confirm-modal');
        const box   = document.getElementById('confirm-modal-box');
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'all';
        box.style.transform = 'scale(1)';
    });
}
function _confirmResolve(result) {
    const modal = document.getElementById('confirm-modal');
    const box   = document.getElementById('confirm-modal-box');
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
    box.style.transform = 'scale(0.92)';
    if (_confirmCallback) { _confirmCallback(result); _confirmCallback = null; }
}

async function searchStudent() {
    const classId = document.getElementById('search-class-id').value.trim();
    if (!classId) return;

    const { data, error } = await supabaseClient.from('students').select('*').eq('class_id', classId).maybeSingle();

    if (error) {
        showToast(error.message, 'error');
        return;
    }

    if (!data) {
        const yes = await showConfirm();
        if (yes) {
            showRegistration(classId);
        }
        return;
    }

    currentStudent = data;
    document.getElementById('search-section').classList.add('d-none');
    document.getElementById('update-section').classList.remove('d-none');
    history.replaceState(null, '', '#profile');

    const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ');
    document.getElementById('display-name').innerText = fullName || 'New Student';
    document.getElementById('display-id').innerText = data.class_id;

    document.getElementById('first-name').value = data.first_name || '';
    document.getElementById('last-name').value = data.last_name || '';
    document.getElementById('nic').value = data.nic || '';
    document.getElementById('email').value = data.email || '';

    // --- Name lock (name_edited flag) ---
    if (data.name_edited) {
        document.getElementById('first-name').readOnly = true;
        document.getElementById('last-name').readOnly = true;
        document.getElementById('name-lock').style.display = 'block';
        document.getElementById('name-lock-2').style.display = 'block';
        document.getElementById('name-warning').innerText = 'Verified Record (Locked)';
        document.getElementById('name-warning').style.color = 'var(--primary-color)';
    }

    // --- NIC lock ---
    if (data.nic_edited) {
        document.getElementById('nic').readOnly = true;
        document.getElementById('nic-lock').style.display = 'block';
        document.getElementById('nic-warning').innerText = 'Verified Record (Locked)';
        document.getElementById('nic-warning').style.color = 'var(--primary-color)';
    }

    // --- Email lock ---
    if (data.email_edited) {
        document.getElementById('email').readOnly = true;
        document.getElementById('email-lock').style.display = 'block';
        document.getElementById('email-warning').innerText = 'Verified Record (Locked)';
        document.getElementById('email-warning').style.color = 'var(--primary-color)';
    }

    // Load paper history
    loadStudentPapers(classId);
}

async function updateStudent() {
    const firstName = document.getElementById('first-name').value.trim();
    const lastName  = document.getElementById('last-name').value.trim();
    const nic       = document.getElementById('nic').value.trim();
    const email     = document.getElementById('email').value.trim();

    const updates = {};

    // Name update — only if not already locked
    if (!currentStudent.name_edited) {
        if (firstName || lastName) {
            updates.first_name  = firstName;
            updates.last_name   = lastName;
            updates.name_edited = true;
        }
    }

    // NIC update — only if not already locked
    if (!currentStudent.nic_edited && nic && nic !== currentStudent.nic) {
        updates.nic        = nic;
        updates.nic_edited = true;
    }

    // Email update — only if not already locked
    if (!currentStudent.email_edited && email && email !== currentStudent.email) {
        updates.email        = email;
        updates.email_edited = true;
    }

    if (Object.keys(updates).length === 0) {
        showToast('No changes to save.', 'error');
        return;
    }

    const { error } = await supabaseClient.from('students').update(updates).eq('class_id', currentStudent.class_id);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Profile updated successfully!');
        // Refresh current data
        Object.assign(currentStudent, updates);
        searchStudent();
    }
}

// ==============================
// Paper History
// ==============================
async function loadStudentPapers(classId) {
    const listEl   = document.getElementById('paper-history-list');
    const badgeEl  = document.getElementById('paper-count-badge');

    listEl.innerHTML = `<div style="text-align:center; padding:24px 0;">
        <i class='bx bx-loader-alt bx-spin' style="font-size:24px; color:var(--text-muted);"></i>
    </div>`;

    const { data, error } = await supabaseClient
        .from('attendance')
        .select('paper_number, note, scanned_at')
        .eq('class_id', classId)
        .order('scanned_at', { ascending: false });

    if (error) {
        listEl.innerHTML = `<p class="text-muted" style="text-align:center; font-size:13px;">Could not load paper history.</p>`;
        return;
    }

    badgeEl.innerHTML = `${data.length} Papers <span style="display:block;font-size:9px;font-weight:400;opacity:0.75;font-family:Arial,sans-serif;">${data.length} පත්‍රිකා</span>`;

    if (data.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center; padding:24px 0;">
                <i class='bx bx-book-bookmark' style="font-size:40px; color:var(--text-muted); opacity:0.4;"></i>
                <p class="text-muted" style="font-size:13px; margin-top:10px;">No papers recorded yet.</p>
            </div>`;
        return;
    }

    listEl.innerHTML = data.map((row, index) => {
        const dt      = new Date(row.scanned_at);
        const dateStr = dt.toLocaleDateString('si-LK', { year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

        return `
        <div style="
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 14px 0;
            ${index < data.length - 1 ? 'border-bottom: 1px solid var(--border-color);' : ''}
        ">
            <!-- Number badge -->
            <div style="
                min-width: 36px; height: 36px;
                background: rgba(16,185,129,0.1);
                border: 1px solid rgba(16,185,129,0.25);
                border-radius: 10px;
                display: flex; align-items: center; justify-content: center;
                font-size: 12px; font-weight: 700; color: var(--primary-color);
            ">${index + 1}</div>

            <!-- Paper info -->
            <div style="flex:1; min-width:0;">
                <div style="font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${row.paper_number}
                </div>
                ${row.note ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${row.note}</div>` : ''}
            </div>

            <!-- Date & time -->
            <div style="text-align:right; flex-shrink:0;">
                <div style="font-size:11px; color:var(--text-color); font-weight:500;">${dateStr}</div>
                <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">${timeStr}</div>
            </div>
        </div>`;
    }).join('');
}

// ==============================
// Registration Flow
// ==============================
function showRegistration(prefillId = '') {
    document.getElementById('search-section').classList.add('d-none');
    document.getElementById('registration-section').classList.remove('d-none');
    history.replaceState(null, '', '#register');
    if (prefillId) {
        document.getElementById('reg-class-id').value = prefillId;
        document.getElementById('reg-details').classList.remove('d-none');
    }
}

function startRegScanner() {
    document.getElementById('reg-scan-btn').classList.add('d-none');
    regScanner = new Html5Qrcode("student-reader");
    regScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            document.getElementById('reg-class-id').value = decodedText;
            document.getElementById('reg-details').classList.remove('d-none');
            stopRegScanner();
            showToast('Card scanned successfully!');
        },
        (errorMessage) => { /* ignore */ }
    ).catch(err => {
        showToast("Scanner Error: " + err, "error");
        document.getElementById('reg-scan-btn').classList.remove('d-none');
    });
}

function stopRegScanner() {
    if (regScanner) {
        regScanner.stop().then(() => {
            document.getElementById('reg-scan-btn').classList.remove('d-none');
        }).catch(err => console.log(err));
    }
}

async function registerStudent() {
    const classId   = document.getElementById('reg-class-id').value.trim();
    const firstName = document.getElementById('reg-first-name').value.trim();
    const lastName  = document.getElementById('reg-last-name').value.trim();
    const nic       = document.getElementById('reg-nic').value.trim();
    const email     = document.getElementById('reg-email').value.trim();

    if (!classId || !firstName || !lastName || !nic || !email) {
        showToast('Please fill all details', 'error');
        return;
    }

    // Check if ID already exists
    const { data: existing } = await supabaseClient.from('students').select('class_id').eq('class_id', classId).maybeSingle();
    if (existing) {
        showToast('This Class ID is already registered!', 'error');
        return;
    }

    const { error } = await supabaseClient.from('students').insert([{
        class_id:     classId,
        first_name:   firstName,
        last_name:    lastName,
        nic:          nic,
        email:        email,
        name_edited:  true,
        nic_edited:   true,
        email_edited: true
    }]);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Account created successfully!');
        setTimeout(() => location.reload(), 2000);
    }
}
