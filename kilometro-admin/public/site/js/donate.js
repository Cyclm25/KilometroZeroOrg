const state = { donor: null };

const refs = {
    statusPill: document.getElementById("statusPill"),
    statusText: document.getElementById("statusText"),
    registerSuccess: document.getElementById("registerSuccess"),
    registerNotice: document.getElementById("registerNotice"),
    verifySuccess: document.getElementById("verifySuccess"),
    verifyNotice: document.getElementById("verifyNotice"),
    kycSuccess: document.getElementById("kycSuccess"),
    kycNotice: document.getElementById("kycNotice"),
    loginSuccess: document.getElementById("loginSuccess"),
    loginNotice: document.getElementById("loginNotice"),
    donationSuccess: document.getElementById("donationSuccess"),
    donationNotice: document.getElementById("donationNotice"),
};

function showMessage(el, message, type = "notice") {
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("show");
    if (message) el.classList.add("show");
}

function clearMessages() {
    Object.values(refs).forEach((el) => {
        if (el && (el.classList.contains("notice") || el.classList.contains("success"))) {
            el.classList.remove("show");
            el.textContent = "";
        }
    });
}

function syncFields(email = "") {
    ["registerEmail", "verifyEmail", "loginEmail"].forEach((id) => {
        const el = document.getElementById(id);
        if (el && email) el.value = email;
    });
}

function renderStatus(donor) {
    const status = donor ? donor.kyc_status : "not_started";
    const emailVerified = donor ? donor.email_verified : false;
    const approved = donor && donor.kyc_status === "approved";

    let pillClass = "status-not_started";
    let pillText = "Not signed in";
    let message = "Create an account or log in to continue.";

    if (donor) {
        if (!emailVerified) {
            pillClass = "status-pending";
            pillText = "Email unverified";
            message = "Verify your email address using the code that was sent to you.";
        } else if (status === "pending") {
            pillClass = "status-pending";
            pillText = "KYC pending review";
            message = "Your documents were submitted and are awaiting administrator review.";
        } else if (status === "approved") {
            pillClass = "status-approved";
            pillText = "KYC approved";
            message = "Your account is approved. You can now donate with this verified account.";
        } else if (status === "rejected") {
            pillClass = "status-rejected";
            pillText = "KYC rejected";
            message = donor.kyc_rejection_reason || "Your submission was rejected. Please resubmit updated documents.";
        } else {
            pillClass = "status-not_started";
            pillText = "KYC not started";
            message = "Finish email verification, then submit your documents.";
        }
    }

    refs.statusPill.className = `status-pill ${pillClass}`;
    refs.statusPill.textContent = pillText;
    refs.statusText.textContent = message;

    const donationForm = document.getElementById("donationForm");
    const donationLocked = document.getElementById("donationLocked");
    if (donor && approved) {
        donationForm.classList.remove("hidden");
        donationLocked.classList.add("hidden");
    } else {
        donationForm.classList.add("hidden");
        donationLocked.classList.remove("hidden");
    }
}

async function apiRequest(path, options = {}) {
    const res = await fetch(path, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.error || "Request failed.");
    }
    return body;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Unable to read the selected file."));
        reader.readAsDataURL(file);
    });
}

async function refreshStatus() {
    try {
        const data = await apiRequest("/api/donors/me");
        state.donor = data.donor;
        syncFields(state.donor.email);
        renderStatus(state.donor);
    } catch (err) {
        state.donor = null;
        renderStatus(null);
    }
}

async function registerDonor() {
    clearMessages();
    const payload = {
        name: document.getElementById("registerName").value,
        email: document.getElementById("registerEmail").value,
        password: document.getElementById("registerPassword").value,
    };
    const data = await apiRequest("/api/donors/register", {
        method: "POST",
        body: JSON.stringify(payload),
    });
    state.donor = data.donor;
    syncFields(data.donor.email);
    renderStatus(state.donor);
    showMessage(refs.registerSuccess, data.message || "Verification code sent.");
    if (data.verificationCode) {
        showMessage(refs.registerNotice, `Development verification code: ${data.verificationCode}`);
    }
}

async function verifyEmail() {
    clearMessages();
    const payload = {
        email: document.getElementById("verifyEmail").value,
        code: document.getElementById("verifyCode").value,
    };
    const data = await apiRequest("/api/donors/verify-email", {
        method: "POST",
        body: JSON.stringify(payload),
    });
    state.donor = data.donor;
    syncFields(data.donor.email);
    renderStatus(state.donor);
    showMessage(refs.verifySuccess, data.message || "Email verified.");
}

async function submitKyc() {
    clearMessages();
    const documentFile = document.getElementById("kycDocument").files[0];
    const selfieFile = document.getElementById("kycSelfie").files[0];
    if (!documentFile || !selfieFile) {
        throw new Error("Both document files are required.");
    }
    if (documentFile.size > 5 * 1024 * 1024 || selfieFile.size > 5 * 1024 * 1024) {
        throw new Error("Each file must be 5 MB or smaller.");
    }

    const [documentDataUrl, selfieDataUrl] = await Promise.all([
        fileToDataUrl(documentFile),
        fileToDataUrl(selfieFile),
    ]);

    const payload = {
        idType: document.getElementById("kycIdType").value,
        idNumber: document.getElementById("kycIdNumber").value,
        document: { name: documentFile.name, dataUrl: documentDataUrl },
        selfie: { name: selfieFile.name, dataUrl: selfieDataUrl },
    };

    const data = await apiRequest("/api/donors/kyc", {
        method: "POST",
        body: JSON.stringify(payload),
    });
    state.donor = data.donor;
    renderStatus(state.donor);
    showMessage(refs.kycSuccess, data.message || "KYC submitted.");
}

async function loginDonor() {
    clearMessages();
    const payload = {
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value,
    };
    const data = await apiRequest("/api/donors/login", {
        method: "POST",
        body: JSON.stringify(payload),
    });
    state.donor = data.donor;
    syncFields(data.donor.email);
    renderStatus(state.donor);
    showMessage(refs.loginSuccess, "Logged in successfully.");
}

async function donate() {
    clearMessages();
    const amount = Number(document.getElementById("donationAmount").value || 0);
    const note = document.getElementById("donationPurpose").value.trim();
    const data = await apiRequest("/api/donors/donations", {
        method: "POST",
        body: JSON.stringify({ amount, note }),
    });
    showMessage(refs.donationSuccess, `Donation accepted. Reference #${data.donationId}.`);
}

async function logout() {
    try {
        await apiRequest("/api/donors/logout", { method: "POST" });
    } catch (err) {
        // Ignore logout failures and clear the local state.
    }
    state.donor = null;
    renderStatus(null);
}

document.getElementById("refreshStatusBtn").addEventListener("click", refreshStatus);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await registerDonor(); } catch (err) { showMessage(refs.registerNotice, err.message); }
});
document.getElementById("verifyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await verifyEmail(); } catch (err) { showMessage(refs.verifyNotice, err.message); }
});
document.getElementById("kycForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await submitKyc(); } catch (err) { showMessage(refs.kycNotice, err.message); }
});
document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await loginDonor(); } catch (err) { showMessage(refs.loginNotice, err.message); }
});
document.getElementById("donationForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await donate(); } catch (err) { showMessage(refs.donationNotice, err.message); }
});

refreshStatus();
