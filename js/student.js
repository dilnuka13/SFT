let currentStudent = null;
let regScanner = null;

async function searchStudent() {
    const classId = document.getElementById('search-class-id').value;
    if (!classId) return;

    const { data, error } = await supabaseClient.from('students').select('*').eq('class_id', classId).maybeSingle();

    if (error) {
        showToast(error.message, 'error');
        return;
    }

    if (!data) {
        if (confirm('Account not found. Would you like to create a new account for this Class ID?')) {
            showRegistration(classId);
        }
        return;
    }

    currentStudent = data;
    document.getElementById('search-section').classList.add('d-none');
    document.getElementById('update-section').classList.remove('d-none');

    document.getElementById('display-name').innerText = (data.first_name || data.last_name) ? `${data.first_name || ''} ${data.last_name || ''}` : 'New Student';
    document.getElementById('display-id').innerText = data.class_id;

    document.getElementById('first-name').value = data.first_name || '';
    document.getElementById('last-name').value = data.last_name || '';
    document.getElementById('nic').value = data.nic || '';
    document.getElementById('email').value = data.email || '';

    if (data.nic_edited) {
        document.getElementById('nic').readOnly = true;
        document.getElementById('nic-lock').style.display = 'block';
        document.getElementById('nic-warning').innerText = 'Verified Record (Locked)';
        document.getElementById('nic-warning').style.color = 'var(--primary-color)';
    }

    if (data.email_edited) {
        document.getElementById('email').readOnly = true;
        document.getElementById('email-lock').style.display = 'block';
        document.getElementById('email-warning').innerText = 'Verified Record (Locked)';
        document.getElementById('email-warning').style.color = 'var(--primary-color)';
    }
}

async function updateStudent() {
    const firstName = document.getElementById('first-name').value;
    const lastName = document.getElementById('last-name').value;
    const nic = document.getElementById('nic').value;
    const email = document.getElementById('email').value;

    const updates = {
        first_name: firstName,
        last_name: lastName
    };

    if (!currentStudent.nic_edited && nic && nic !== currentStudent.nic) {
        updates.nic = nic;
        updates.nic_edited = true;
    }

    if (!currentStudent.email_edited && email && email !== currentStudent.email) {
        updates.email = email;
        updates.email_edited = true;
    }

    const { error } = await supabaseClient.from('students').update(updates).eq('class_id', currentStudent.class_id);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Details updated successfully');
        // Refresh data
        searchStudent();
    }
}

// Registration Flow
function showRegistration(prefillId = '') {
    document.getElementById('search-section').classList.add('d-none');
    document.getElementById('registration-section').classList.remove('d-none');
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
    const classId = document.getElementById('reg-class-id').value;
    const firstName = document.getElementById('reg-first-name').value;
    const lastName = document.getElementById('reg-last-name').value;
    const nic = document.getElementById('reg-nic').value;
    const email = document.getElementById('reg-email').value;

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
        class_id: classId,
        first_name: firstName,
        last_name: lastName,
        nic: nic,
        email: email,
        nic_edited: true,
        email_edited: true
    }]);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Account created successfully!');
        setTimeout(() => location.reload(), 2000);
    }
}
