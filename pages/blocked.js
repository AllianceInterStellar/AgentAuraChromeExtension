const url = new URLSearchParams(window.location.search).get('url')
if (url) {
    document.getElementById('blocked-url').textContent = url
}
document.getElementById('go-back').addEventListener('click', () => {
    if (window.history.length > 1) {
        window.history.back()
    } else {
        window.close()
    }
})