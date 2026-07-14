// public/admin/js/api.js
// Thin fetch wrapper for the admin dashboard. Cookies (httpOnly JWT) are
// sent automatically by the browser via `credentials: "same-origin"`.

async function apiRequest(path, options = {}) {
    const res = await fetch(path, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...options,
    });

    if (res.status === 401 || res.status === 403) {
        // Session expired/invalid or role check failed - server already
        // cleared the cookie. Bounce to login.
        window.location.href = "/admin/login";
        return null;
    }

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
    }

    if (res.status === 204) return null;
    return res.json();
}

const api = {
    get: (path) => apiRequest(path),
    post: (path, body) => apiRequest(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
    patch: (path, body) => apiRequest(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
    del: (path) => apiRequest(path, { method: "DELETE" }),
};
