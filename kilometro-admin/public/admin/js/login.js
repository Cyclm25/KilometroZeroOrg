// public/admin/js/login.js
// Moved out of an inline <script> tag so it isn't blocked by the
// Content-Security-Policy (which only allows scripts from same-origin files).

const form = document.getElementById("loginForm");
const errorBox = document.getElementById("loginError");
const btn = document.getElementById("loginBtn");

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.classList.remove("show");
    btn.disabled = true;
    btn.textContent = "Signing in...";

    try {
        const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
                email: document.getElementById("email").value,
                password: document.getElementById("password").value,
            }),
        });
        const data = await res.json();

        if (!res.ok) {
            errorBox.textContent = data.error || "Login failed.";
            errorBox.classList.add("show");
            btn.disabled = false;
            btn.textContent = "Sign In";
            return;
        }

        window.location.href = "/admin";
    } catch (err) {
        errorBox.textContent = "Could not reach the server. Please try again.";
        errorBox.classList.add("show");
        btn.disabled = false;
        btn.textContent = "Sign In";
    }
});