const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBdKqX4ZPKnw1sM1c09_dGtiBJlFV13iSs',
    authDomain: 'allweb-bdde3.firebaseapp.com',
    projectId: 'allweb-bdde3',
    googleClientId: '1056486259347-bgi2ki44q2vkbrsth1n4cmkd7r2feg9c.apps.googleusercontent.com'
}

const AUTH_API = `https://identitytoolkit.googleapis.com/v1`
const GOOGLE_OAUTH_SCOPES = ['openid', 'email', 'profile']

// A Firebase id token lives for an hour. Refresh a little before that, and again on demand
// when a request comes back 401.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000
const TOKEN_LIFETIME_FALLBACK_MS = 55 * 60 * 1000

class AuthService {
    constructor() {
        this.currentUser = null
        this.idToken = null
        this.refreshToken = null
        this.listeners = []
        this._refreshTimer = null
        this._refreshing = null
        this._applyingRemote = false

        // Every page (side panel, the embedded manage page) has its own AuthService. The
        // token lives in storage; when one context signs in, refreshes or signs out, the
        // others follow instead of keeping a stale or different user.
        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') return
                if (!('auth_id_token' in changes) && !('auth_user' in changes) && !('auth_refresh_token' in changes)) return
                if (this._applyingRemote) return
                this._adoptStoredAuth().catch(() => { })
            })
        } catch (_) { }

        if (typeof apiClient !== 'undefined' && apiClient) {
            apiClient.onUnauthorized = () => this.refreshAccessToken()
        }
    }

    async _adoptStoredAuth() {
        const stored = await chrome.storage.local.get(['auth_user', 'auth_id_token', 'auth_refresh_token'])
        const changed = stored.auth_id_token !== this.idToken
        this.currentUser = stored.auth_user || null
        this.idToken = stored.auth_id_token || null
        this.refreshToken = stored.auth_refresh_token || null
        if (typeof apiClient !== 'undefined' && apiClient) apiClient.setAuthToken(this.idToken)
        this._scheduleRefresh()
        if (changed) this._notifyListeners()
    }

    /** Milliseconds until the current id token expires, read from its `exp` claim. */
    _tokenRemainingMs() {
        if (!this.idToken) return 0
        try {
            const payload = JSON.parse(atob(this.idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
            if (payload && payload.exp) return payload.exp * 1000 - Date.now()
        } catch (_) { }
        return TOKEN_LIFETIME_FALLBACK_MS
    }

    _scheduleRefresh() {
        clearTimeout(this._refreshTimer)
        this._refreshTimer = null
        if (!this.refreshToken || !this.idToken) return
        const delay = Math.max(this._tokenRemainingMs() - TOKEN_REFRESH_MARGIN_MS, 5000)
        // Timers do not fire while the page is closed; init() and the 401 path cover that.
        this._refreshTimer = setTimeout(() => {
            this.refreshAccessToken().catch(() => { })
        }, Math.min(delay, 2 ** 31 - 1))
    }

    onAuthStateChanged(callback) {
        this.listeners.push(callback)
        callback(this.currentUser)
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback)
        }
    }

    _notifyListeners() {
        this.listeners.forEach(cb => cb(this.currentUser))
    }

    _getGoogleClientId() {
        try {
            const manifest = chrome.runtime?.getManifest?.()
            return manifest?.oauth2?.client_id || FIREBASE_CONFIG.googleClientId || null
        } catch (_) {
            return FIREBASE_CONFIG.googleClientId || null
        }
    }

    _randomString(length = 32) {
        const bytes = crypto.getRandomValues(new Uint8Array(length))
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    }

    _formatAuthError(errorData, fallbackMessage) {
        const code = errorData?.error?.message || ''

        switch (code) {
            case 'EMAIL_EXISTS':
                return 'This email address is already registered'
            case 'EMAIL_NOT_FOUND':
                return 'No account was found for this email address'
            case 'INVALID_PASSWORD':
                return 'The password is incorrect'
            case 'USER_DISABLED':
                return 'This account has been disabled'
            case 'WEAK_PASSWORD : Password should be at least 6 characters':
            case 'WEAK_PASSWORD':
                return 'Password must be at least 6 characters'
            case 'INVALID_OAUTH_CLIENT_ID':
            case 'MISSING_OAUTH_CLIENT_ID':
                return 'Google sign-in is not configured for this extension yet'
            case 'CREDENTIAL_ALREADY_IN_USE':
            case 'FEDERATED_USER_ID_ALREADY_LINKED':
                return 'This Google account is already linked to another user'
            case 'INVALID_IDP_RESPONSE':
            case 'INVALID_PENDING_TOKEN':
                return 'Google sign-in failed. Please try again'
            case 'OPERATION_NOT_ALLOWED':
                return 'This sign-in method is not enabled in Firebase'
            default:
                return fallbackMessage || code || 'Authentication failed'
        }
    }

    _buildUser(data, overrides = {}) {
        const providerId = overrides.providerId
            || data.providerId
            || data.oauthProvider
            || data.providerUserInfo?.[0]?.providerId
            || (overrides.isAnonymous ? 'anonymous' : data.email ? 'password' : null)

        return {
            uid: data.localId,
            isAnonymous: overrides.isAnonymous ?? providerId === 'anonymous',
            email: overrides.email ?? data.email ?? null,
            displayName: overrides.displayName ?? data.displayName ?? data.fullName ?? null,
            providerId
        }
    }

    async _applyAuthResponse(data, overrides = {}) {
        this.currentUser = this._buildUser(data, overrides)
        this.idToken = data.idToken || data.id_token || null
        this.refreshToken = data.refreshToken || data.refresh_token || null
        apiClient.setAuthToken(this.idToken)
        await this._persistAuth()
        this._scheduleRefresh()
        this._notifyListeners()
        return this.currentUser
    }

    async _launchGoogleAuthFlow() {
        const clientId = this._getGoogleClientId()
        if (!clientId) throw new Error('Google Client ID not configured')

        const redirectUri = chrome.identity.getRedirectURL()
        const nonce = this._randomString()

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', clientId)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('response_type', 'token')
        authUrl.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '))
        authUrl.searchParams.set('prompt', 'select_account')
        authUrl.searchParams.set('nonce', nonce)

        const responseUrl = await new Promise((resolve, reject) => {
            chrome.identity.launchWebAuthFlow(
                { url: authUrl.toString(), interactive: true },
                callbackUrl => {
                    if (chrome.runtime.lastError) {
                        const msg = chrome.runtime.lastError.message || 'Google sign-in failed'
                        if (/cancel|closed|user did not approve/i.test(msg)) {
                            reject(new Error('Google sign-in was cancelled'))
                        } else {
                            reject(new Error(msg))
                        }
                        return
                    }
                    resolve(callbackUrl)
                }
            )
        })

        const fragment = responseUrl.split('#')[1] || ''
        const params = new URLSearchParams(fragment)
        const accessToken = params.get('access_token')

        if (!accessToken) {
            throw new Error('No access token received from Google')
        }

        return { accessToken }
    }

    async _authenticateWithGoogle(accessToken, linkCurrentUser = false) {
        const body = {
            requestUri: 'https://localhost',
            postBody: `access_token=${encodeURIComponent(accessToken)}&providerId=google.com`,
            returnSecureToken: true,
            returnIdpCredential: true
        }

        if (linkCurrentUser && this.idToken) {
            body.idToken = this.idToken
        }

        const response = await fetch(
            `${AUTH_API}/accounts:signInWithIdp?key=${FIREBASE_CONFIG.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }
        )

        const data = await response.json()

        if (!response.ok) {
            throw new Error(this._formatAuthError(data, 'Google sign-in failed'))
        }

        return this._applyAuthResponse(data, {
            isAnonymous: false,
            providerId: 'google.com'
        })
    }

    async init() {
        const stored = await chrome.storage.local.get(['auth_user', 'auth_id_token', 'auth_refresh_token'])
        if (stored.auth_user && stored.auth_id_token) {
            this.currentUser = stored.auth_user
            this.idToken = stored.auth_id_token
            this.refreshToken = stored.auth_refresh_token || null
            apiClient.setAuthToken(this.idToken)
            // Waited for: the first request must not go out with a token that expired while
            // the panel was closed.
            if (this._tokenRemainingMs() < TOKEN_REFRESH_MARGIN_MS) {
                await this.refreshAccessToken().catch(() => { })
            }
            this._scheduleRefresh()
            this._notifyListeners()
        }
    }

    /** Kept for callers of the old name. */
    async _refreshTokenIfNeeded() {
        if (this._tokenRemainingMs() < TOKEN_REFRESH_MARGIN_MS) {
            await this.refreshAccessToken().catch(() => { })
        }
    }

    /**
     * Exchanges the refresh token for a new id token. Concurrent callers share one request. On
     * a definitive refusal (the refresh token was revoked) the session is cleared, so the UI
     * shows the sign-in screen instead of failing every request.
     */
    async refreshAccessToken() {
        if (!this.refreshToken) return null
        if (this._refreshing) return this._refreshing

        this._refreshing = (async () => {
            try {
                const response = await fetch(
                    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            grant_type: 'refresh_token',
                            refresh_token: this.refreshToken
                        })
                    }
                )
                if (response.ok) {
                    const data = await response.json()
                    this.idToken = data.id_token
                    this.refreshToken = data.refresh_token || this.refreshToken
                    apiClient.setAuthToken(this.idToken)
                    await this._persistAuth()
                    this._scheduleRefresh()
                    return this.idToken
                }
                if (response.status === 400 || response.status === 401 || response.status === 403) {
                    // TOKEN_EXPIRED / USER_DISABLED / USER_NOT_FOUND: nothing will make this work.
                    console.warn('Refresh token rejected; signing out')
                    await this.signOut()
                    return null
                }
                console.error('Token refresh failed:', response.status)
                return null
            } catch (e) {
                console.error('Token refresh failed:', e)
                return null
            } finally {
                this._refreshing = null
            }
        })()
        return this._refreshing
    }

    async signInAnonymously() {
        try {
            const response = await fetch(
                `${AUTH_API}/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ returnSecureToken: true })
                }
            )
            if (!response.ok) throw new Error('Anonymous sign-in failed')
            const data = await response.json()
            return this._applyAuthResponse(data, {
                isAnonymous: true,
                providerId: 'anonymous'
            })
        } catch (e) {
            console.error('Anonymous sign-in error:', e)
            throw e
        }
    }

    async signInWithEmail(email, password) {
        try {
            const response = await fetch(
                `${AUTH_API}/accounts:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, returnSecureToken: true })
                }
            )
            if (!response.ok) {
                const err = await response.json()
                throw new Error(this._formatAuthError(err, 'Sign-in failed'))
            }
            const data = await response.json()
            return this._applyAuthResponse(data, {
                isAnonymous: false,
                providerId: 'password'
            })
        } catch (e) {
            console.error('Email sign-in error:', e)
            throw e
        }
    }

    async signUpWithEmail(email, password) {
        try {
            const response = await fetch(
                `${AUTH_API}/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, returnSecureToken: true })
                }
            )
            if (!response.ok) {
                const err = await response.json()
                throw new Error(this._formatAuthError(err, 'Sign-up failed'))
            }
            const data = await response.json()
            return this._applyAuthResponse(data, {
                isAnonymous: false,
                providerId: 'password'
            })
        } catch (e) {
            console.error('Email sign-up error:', e)
            throw e
        }
    }

    async signInWithGoogle() {
        try {
            const { accessToken } = await this._launchGoogleAuthFlow()
            return await this._authenticateWithGoogle(accessToken, false)
        } catch (e) {
            console.error('Google sign-in error:', e)
            throw e
        }
    }

    async linkWithGoogle() {
        if (!this.idToken) {
            return this.signInWithGoogle()
        }

        try {
            const { accessToken } = await this._launchGoogleAuthFlow()
            return await this._authenticateWithGoogle(accessToken, true)
        } catch (e) {
            console.error('Google link error:', e)
            throw e
        }
    }

    async signOut() {
        this.currentUser = null
        this.idToken = null
        this.refreshToken = null
        clearTimeout(this._refreshTimer)
        this._refreshTimer = null
        apiClient.setAuthToken(null)
        this._applyingRemote = true
        try {
            await chrome.storage.local.remove(['auth_user', 'auth_id_token', 'auth_refresh_token'])
        } finally {
            this._applyingRemote = false
        }
        this._notifyListeners()
    }

    async _persistAuth() {
        this._applyingRemote = true
        try {
            await chrome.storage.local.set({
                auth_user: this.currentUser,
                auth_id_token: this.idToken,
                auth_refresh_token: this.refreshToken
            })
        } finally {
            this._applyingRemote = false
        }
    }

    isAuthenticated() {
        return !!this.currentUser && !!this.idToken
    }

    getDisplayName() {
        if (!this.currentUser) return 'Guest'
        return this.currentUser.displayName || this.currentUser.email || 'Guest'
    }
}

const authService = new AuthService()
