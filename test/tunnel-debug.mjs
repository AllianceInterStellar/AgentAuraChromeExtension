import http from 'node:http'
import tls from 'node:tls'

const proxy = { host: '127.0.0.1', port: 22334 }
// Whichever host you want to reach through the local proxy.
const target = process.env.AGENTAURA_TUNNEL_TARGET || 'example.com'

console.log('1. Initiating CONNECT tunnel...')
const req = http.request({ host: proxy.host, port: proxy.port, method: 'CONNECT', path: `${target}:443` })
req.on('connect', (res, socket) => {
    console.log(`2. CONNECT status: ${res.statusCode}`)
    if (res.statusCode !== 200) { socket.destroy(); process.exit(1) }
    console.log('3. Attempting TLS handshake...')
    const tlsSock = tls.connect({ socket, servername: target, rejectUnauthorized: false }, () => {
        console.log(`4. TLS OK, authorized: ${tlsSock.authorized}`)
        const cert = tlsSock.getPeerCertificate()
        console.log(`5. Cert CN: ${cert?.subject?.CN || 'N/A'}`)
        console.log('6. Sending HTTP upgrade to test WebSocket...')
        tlsSock.write(
            'GET / HTTP/1.1\r\n' +
            `Host: ${target}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        )
        let data = ''
        tlsSock.on('data', c => {
            data += c.toString()
            if (data.includes('\r\n\r\n')) {
                const statusLine = data.split('\r\n')[0]
                console.log(`7. WS upgrade response: ${statusLine}`)
                tlsSock.destroy()
                process.exit(0)
            }
        })
        setTimeout(() => { console.log('7. WS upgrade timeout, partial:', data.slice(0, 200)); tlsSock.destroy(); process.exit(1) }, 10000)
    })
    tlsSock.on('error', e => { console.error(`TLS error: ${e.message}`); process.exit(1) })
})
req.on('error', e => { console.error(`CONNECT error: ${e.message}`); process.exit(1) })
req.setTimeout(15000, () => { req.destroy(); console.error('Proxy timeout'); process.exit(1) })
req.end()
