const SUPABASE_URL = 'https://fmtndmezfqnqenumhpjm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtdG5kbWV6ZnFucWVudW1ocGptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MTQxOTYsImV4cCI6MjA5MzM5MDE5Nn0.Wzc38hyfuu1AzfJpMy8wHisgMXZGdAnjzBTvnHqWlOA';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    toastMsg.innerText = msg;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}
