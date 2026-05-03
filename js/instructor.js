let currentInstructor = null;
let html5QrCode = null;

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
    populateExportPapers();

    // Sync avatar to both PC and mobile headers
    if (currentInstructor.avatar_url) {
        document.getElementById('current-profile-img').src = currentInstructor.avatar_url;
        document.getElementById('pc-user-avatar').src = currentInstructor.avatar_url;
        document.getElementById('mobile-user-avatar').src = currentInstructor.avatar_url;
    }

    // Sync username
    document.getElementById('current-user-name').innerText = currentInstructor.name;
    document.getElementById('pc-user-name').innerText = currentInstructor.name;
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

function downloadQR() {
    const qrImg = document.querySelector('#student-qr-display img');
    if (!qrImg) return;
    const link = document.createElement('a');
    link.download = 'student-registration-qr.png';
    link.href = qrImg.src;
    link.click();
}

function switchTab(tab) {
    // Update PC sidebar links
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    const pcLink = document.getElementById(`pc-link-${tab}`);
    if (pcLink) pcLink.classList.add('active');

    // Update mobile nav items
    document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
    const mobLink = document.getElementById(`mob-link-${tab}`);
    if (mobLink) mobLink.classList.add('active');

    // Show/hide sections
    if (tab === 'scanner') {
        document.getElementById('scanner-section').classList.remove('d-none');
        document.getElementById('reports-section').classList.add('d-none');
        document.getElementById('profile-section').classList.add('d-none');
    } else if (tab === 'reports') {
        document.getElementById('scanner-section').classList.add('d-none');
        document.getElementById('reports-section').classList.remove('d-none');
        document.getElementById('profile-section').classList.add('d-none');
        loadReports();
        stopScanner();
    } else {
        document.getElementById('scanner-section').classList.add('d-none');
        document.getElementById('reports-section').classList.add('d-none');
        document.getElementById('profile-section').classList.remove('d-none');
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
            markAttendance(decodedText);
            // Optionally pause or vibrate
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
        }).catch(err => console.log(err));
    }
}

function processManualId() {
    const id = document.getElementById('manual-id').value;
    if (id) markAttendance(id);
}

async function markAttendance(classId) {
    const paper = document.getElementById('paper-select').value;
    const note = document.getElementById('paper-note').value;
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    // 1. Check if student exists, if not create
    const { data: student, error: sError } = await supabaseClient.from('students').select('*').eq('class_id', classId).maybeSingle();
    
    if (!student) {
        const { error: insertError } = await supabaseClient.from('students').insert([{ class_id: classId }]);
        if (insertError) {
            showToast(insertError.message, 'error');
            return;
        }
    }

    // 2. Add attendance
    const { error: aError } = await supabaseClient.from('attendance').insert([{
        class_id: classId,
        paper_number: paper,
        note: note || null,
        month: month,
        scanned_by: currentInstructor.id
    }]);

    if (aError) {
        showToast(aError.message, 'error');
    } else {
        // Show Success Popup
        document.getElementById('success-msg').innerText = `Class ID: ${classId}\n${paper}`;
        document.getElementById('success-modal').classList.add('active');
        
        // Clear Field
        document.getElementById('manual-id').value = '';
        
        // Auto Close in 5s
        setTimeout(() => {
            closeSuccessModal();
        }, 5000);

        if (navigator.vibrate) navigator.vibrate(200);
    }
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.remove('active');
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

function setupBiometrics() {
    showToast('Biometrics setup coming soon! This requires a secure context (HTTPS) and WebAuthn implementation.', 'info');
}

function removeBiometrics() {
    showToast('Biometrics removed');
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

    tbody.innerHTML = '<tr><td colspan="4" class="text-center"><i class="bx bx-loader-alt bx-spin"></i> Loading...</td></tr>';

    const { data, error } = await supabaseClient
        .from('attendance')
        .select(`
            class_id,
            paper_number,
            scanned_at,
            students (
                first_name,
                last_name
            )
        `)
        .order('scanned_at', { ascending: false })
        .limit(100);

    if (error) {
        showToast(error.message, 'error');
        return;
    }

    tbody.innerHTML = data.map(row => `
        <tr>
            <td style="font-weight: 600; color: var(--primary-color);">${row.class_id}</td>
            <td>${row.students ? `${row.students.first_name || ''} ${row.students.last_name || ''}` : '<span class="text-muted">Not Registered</span>'}</td>
            <td><span class="badge badge-success" style="font-size: 10px;">${row.paper_number}</span></td>
            <td style="font-size: 11px; color: var(--text-muted);">${new Date(row.scanned_at).toLocaleString()}</td>
        </tr>
    `).join('');
}

function populateExportPapers() {
    const grid = document.getElementById('export-paper-grid');
    if (!grid) return;

    let html = '';
    const paperTypes = [];
    for (let i = 30; i <= 60; i++) paperTypes.push(`Black Paper ${i}`);
    paperTypes.push('Special Paper', 'Rank Paper', 'Other');

    html = paperTypes.map(paper => `
        <label class="glass" style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer;">
            <input type="checkbox" class="paper-checkbox" value="${paper}" style="width: 16px; height: 16px; accent-color: var(--primary-color);">
            <span style="font-size: 11px;">${paper}</span>
        </label>
    `).join('');
    
    grid.innerHTML = html;
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
        const logoBase64 = await getImageBase64('logo.png');
        doc.addImage(logoBase64, 'PNG', 14, 5, 30, 15);
    } catch (e) {
        console.error("Logo failed to load", e);
    }

    doc.setFontSize(18);
    doc.text("Attendance & Marking Checklist", 50, 15);
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()} ${month ? `| Month: ${month}` : ''}`, 50, 22);

    const head = [['ID', 'Name', 'Email', ...selectedPapers]];
    const body = studentList.map(s => {
        const row = [s.id, s.name, s.email];
        selectedPapers.forEach(paper => {
            row.push(s.papers[paper] ? '✔' : '');
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
            if (data.section === 'body' && data.column.index >= 3) {
                if (data.cell.text[0] === '✔') {
                    data.cell.styles.textColor = [16, 185, 129];
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fontSize = 12;
                }
            }
        }
    });

    doc.save(`Marking_Checklist_${Date.now()}.pdf`);
    showToast('Attendance checklist exported!');
}

// Auto-login Check
window.addEventListener('load', () => {
    loadInstructorsForLogin();
    const saved = localStorage.getItem('sft_instructor');
    if (saved) {
        currentInstructor = JSON.parse(saved);
        enterDashboard();
    }
});
