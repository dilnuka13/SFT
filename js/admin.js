let currentAdmin = null;
let allStudents = [];

async function adminLogin() {
    const email = document.getElementById('admin-email').value;
    const password = document.getElementById('admin-password').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        showToast(error.message, 'error');
    } else {
        currentAdmin = data.user;
        document.getElementById('admin-login-view').classList.add('d-none');
        document.getElementById('admin-dashboard-view').classList.remove('d-none');
        showToast('Admin logged in successfully');
        initDashboard();
    }
}

async function adminLogout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

function showTab(tab) {
    // Hide all tab content
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');

    // Update PC sidebar active state
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    const pcLink = document.getElementById(`pc-link-${tab}`);
    if (pcLink) pcLink.classList.add('active');

    // Update mobile nav active state
    document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
    const mobLink = document.getElementById(`mob-link-${tab}`);
    if (mobLink) mobLink.classList.add('active');

    if (tab === 'instructors') loadInstructors();
    if (tab === 'students') loadStudents();
    if (tab === 'requests') loadResetRequests();
    if (tab === 'dashboard') loadStats();
}

async function initDashboard() {
    loadStats();
    loadRecentScans();
    loadResetRequests();
    populateExportPapers();
    // Default Tab
    showTab('dashboard');
}

async function loadStats() {
    // 1. Total Students
    const { count: studentCount } = await supabaseClient.from('students').select('*', { count: 'exact', head: true });
    document.getElementById('stat-students').innerText = studentCount || 0;

    // 2. Scanned Today
    const today = new Date().toISOString().split('T')[0];
    const { count: scanCount } = await supabaseClient
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .gte('scanned_at', today + 'T00:00:00')
        .lte('scanned_at', today + 'T23:59:59');
    document.getElementById('stat-scans').innerText = scanCount || 0;

    // 3. Reset Requests
    const { count: requestCount } = await supabaseClient.from('instructors').select('*', { count: 'exact', head: true }).eq('reset_requested', true);
    document.getElementById('stat-requests').innerText = requestCount || 0;
    
    const badge = document.getElementById('request-badge-sidebar');
    if (requestCount > 0) {
        badge.style.display = 'inline-block';
        badge.innerText = requestCount;
    } else {
        badge.style.display = 'none';
    }

    // 4. Instructors
    const { count: instCount } = await supabaseClient.from('instructors').select('*', { count: 'exact', head: true });
    document.getElementById('stat-instructors').innerText = instCount || 0;
}

async function loadRecentScans() {
    const { data, error } = await supabaseClient
        .from('attendance')
        .select('class_id, paper_number, note, scanned_at')
        .order('scanned_at', { ascending: false })
        .limit(5);

    if (error) return;

    const tbody = document.getElementById('recent-scans-table');
    tbody.innerHTML = data.map(scan => `
        <tr>
            <td>${scan.class_id}</td>
            <td>
                <span class="badge badge-success">${scan.paper_number}</span>
                ${scan.note ? `<br><small style="font-size:10px; color:var(--text-muted)">${scan.note}</small>` : ''}
            </td>
            <td style="font-size: 12px; color: var(--text-muted);">${new Date(scan.scanned_at).toLocaleTimeString()}</td>
        </tr>
    `).join('');
}

async function loadInstructors() {
    const { data, error } = await supabaseClient.from('instructors').select('*').order('created_at', { ascending: false });
    if (error) return;

    const tbody = document.getElementById('instructor-list-table');
    tbody.innerHTML = data.map(inst => `
        <tr>
            <td style="display: flex; align-items: center; gap: 12px;">
                <img src="${inst.avatar_url || 'https://via.placeholder.com/40'}" class="avatar-img">
                <span>${inst.name}</span>
            </td>
            <td>${inst.name.toLowerCase().replace(' ', '_')}</td>
            <td>
                ${inst.temp_password 
                    ? '<span class="badge badge-warning">Temp Password</span>' 
                    : '<span class="badge badge-success">Active</span>'}
            </td>
            <td style="font-size: 13px; color: var(--text-muted);">${new Date(inst.created_at).toLocaleDateString()}</td>
            <td>
                <div style="display: flex; gap: 5px;">
                    <button class="btn" style="padding: 6px 10px;" onclick="resetInstructorPassword('${inst.id}')" title="Reset Password"><i class='bx bx-reset'></i></button>
                    <button class="btn btn-danger" style="padding: 6px 10px;" onclick="deleteInstructor('${inst.id}')" title="Delete"><i class='bx bx-trash'></i></button>
                </div>
            </td>
        </tr>
    `).join('');
}

function showAddInstructorModal() {
    document.getElementById('add-instructor-modal').classList.add('active');
    document.getElementById('new-inst-preview').src = 'https://via.placeholder.com/50';
    document.getElementById('new-inst-avatar-file').value = '';
}

let selectedAvatarFile = null;
function previewNewInstructorAvatar(input) {
    if (!input.files || !input.files[0]) return;
    selectedAvatarFile = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('new-inst-preview').src = e.target.result;
    };
    reader.readAsDataURL(selectedAvatarFile);
}

async function addInstructor() {
    const name = document.getElementById('new-inst-name').value;
    const password = document.getElementById('new-inst-pass').value;

    if (!name || !password) {
        showToast('Please fill required fields', 'error');
        return;
    }

    let publicUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`;

    if (selectedAvatarFile) {
        showToast('Uploading avatar...', 'info');
        const fileExt = selectedAvatarFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `avatars/${fileName}`;

        const { data, error } = await supabaseClient.storage
            .from('avatars')
            .upload(filePath, selectedAvatarFile);

        if (!error) {
            const { data: urlData } = supabaseClient.storage
                .from('avatars')
                .getPublicUrl(filePath);
            publicUrl = urlData.publicUrl;
        }
    }

    const { error } = await supabaseClient.from('instructors').insert([{
        name,
        password_hash: password,
        avatar_url: publicUrl,
        temp_password: true
    }]);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Instructor added successfully');
        document.getElementById('add-instructor-modal').classList.remove('active');
        selectedAvatarFile = null;
        loadInstructors();
        loadStats();
    }
}

async function deleteInstructor(id) {
    if (!confirm('Are you sure you want to delete this instructor?')) return;
    const { error } = await supabaseClient.from('instructors').delete().eq('id', id);
    if (error) showToast(error.message, 'error');
    else {
        loadInstructors();
        loadStats();
    }
}

async function resetInstructorPassword(id) {
    const newPass = prompt('Enter new temporary password:');
    if (!newPass) return;
    const { error } = await supabaseClient.from('instructors').update({ 
        password_hash: newPass,
        temp_password: true,
        reset_requested: false
    }).eq('id', id);
    
    if (error) showToast(error.message, 'error');
    else {
        showToast('Password reset successfully');
        loadInstructors();
        loadResetRequests();
        loadStats();
    }
}

async function loadStudents() {
    const { data: students, error: sError } = await supabaseClient.from('students').select('*').order('created_at', { ascending: false });
    const { data: attendance, error: aError } = await supabaseClient.from('attendance').select('class_id');
    
    if (sError) return;

    // Map paper counts
    const paperCounts = {};
    attendance.forEach(a => {
        paperCounts[a.class_id] = (paperCounts[a.class_id] || 0) + 1;
    });

    allStudents = students.map(s => ({
        ...s,
        paper_count: paperCounts[s.class_id] || 0
    }));

    renderStudents(allStudents);
}

function renderStudents(students, query = '') {
    const tbody = document.getElementById('student-list-table');
    
    function highlight(text, q) {
        if (!q || !text) return text;
        const re = new RegExp(`(${q})`, 'gi');
        return text.toString().replace(re, '<span class="highlight">$1</span>');
    }

    tbody.innerHTML = students.map(s => `
        <tr style="cursor: pointer;" onclick="showStudentDetails('${s.class_id}')">
            <td style="font-weight: 600; color: var(--primary-color);">${highlight(s.class_id, query)}</td>
            <td>${highlight(`${s.first_name || ''} ${s.last_name || ''}`, query)}</td>
            <td><span class="badge badge-success">${s.paper_count} Papers</span></td>
            <td>${highlight(s.nic || '-', query)}</td>
            <td>${highlight(s.email || '-', query)}</td>
            <td>
                <button class="btn btn-danger" style="padding: 6px 10px;" onclick="event.stopPropagation(); deleteStudent('${s.class_id}')"><i class='bx bx-trash'></i></button>
            </td>
        </tr>
    `).join('');
}

async function showStudentDetails(classId) {
    const student = allStudents.find(s => s.class_id === classId);
    if (!student) return;

    document.getElementById('modal-student-name').innerText = `${student.first_name || ''} ${student.last_name || ''}`;
    document.getElementById('modal-student-id').innerText = student.class_id;
    document.getElementById('modal-student-nic').innerText = student.nic || '-';
    document.getElementById('modal-student-email').innerText = student.email || '-';

    const { data, error } = await supabaseClient
        .from('attendance')
        .select('*')
        .eq('class_id', classId)
        .order('scanned_at', { ascending: false });

    const tbody = document.getElementById('modal-attendance-table');
    if (error || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No attendance records found</td></tr>';
    } else {
        tbody.innerHTML = data.map(a => `
            <tr>
                <td>${a.paper_number}</td>
                <td>${a.month}</td>
                <td style="font-size: 11px;">${a.note || '-'}</td>
                <td style="font-size: 11px;">${new Date(a.scanned_at).toLocaleDateString()}<br>${new Date(a.scanned_at).toLocaleTimeString()}</td>
            </tr>
        `).join('');
    }

    document.getElementById('student-details-modal').classList.add('active');
}

function filterStudents() {
    const query = document.getElementById('student-search').value.toLowerCase();
    const filtered = allStudents.filter(s => 
        s.class_id.toLowerCase().includes(query) ||
        (s.first_name && s.first_name.toLowerCase().includes(query)) ||
        (s.last_name && s.last_name.toLowerCase().includes(query)) ||
        (s.nic && s.nic.toLowerCase().includes(query)) ||
        (s.email && s.email.toLowerCase().includes(query))
    );
    renderStudents(filtered, query);
}

async function deleteStudent(id) {
    if (!confirm('Delete student and all attendance records?')) return;
    const { error } = await supabaseClient.from('students').delete().eq('class_id', id);
    if (error) showToast(error.message, 'error');
    else {
        loadStudents();
        loadStats();
    }
}

async function loadResetRequests() {
    const { data, error } = await supabaseClient.from('instructors').select('*').eq('reset_requested', true);
    if (error) return;

    const tbody = document.getElementById('request-list-table');
    tbody.innerHTML = data.map(inst => `
        <tr>
            <td style="display: flex; align-items: center; gap: 12px;">
                <img src="${inst.avatar_url}" class="avatar-img">
                <span>${inst.name}</span>
            </td>
            <td style="color: var(--text-muted); font-size: 13px;">Recently</td>
            <td><span class="badge badge-warning">Pending Reset</span></td>
            <td>
                <button class="btn btn-primary" onclick="resetInstructorPassword('${inst.id}')">Reset Now</button>
            </td>
        </tr>
    `).join('');
}

function populateExportPapers() {
    const grid = document.getElementById('export-paper-grid');
    let html = '';
    
    const paperTypes = [];
    for (let i = 30; i <= 60; i++) paperTypes.push(`Black Paper ${i}`);
    paperTypes.push('Special Paper', 'Rank Paper', 'Other');

    html = paperTypes.map(paper => `
        <label class="glass" style="display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer;">
            <input type="checkbox" class="paper-checkbox" value="${paper}" style="width: 20px; height: 20px; accent-color: var(--primary-color);">
            <span style="font-size: 13px;">${paper}</span>
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
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape orientation
    
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

    // Columns: ID, Name, Email, ...Papers
    const head = [['ID', 'Name', 'Email', ...selectedPapers]];
    const body = studentList.map(s => {
        const row = [s.id, s.name, s.email];
        selectedPapers.forEach(paper => {
            // Using a more prominent checkmark or styling
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

// Session Check
window.addEventListener('load', async () => {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) {
        currentAdmin = data.session.user;
        document.getElementById('admin-login-view').classList.add('d-none');
        document.getElementById('admin-dashboard-view').classList.remove('d-none');
        initDashboard();
    }
});
