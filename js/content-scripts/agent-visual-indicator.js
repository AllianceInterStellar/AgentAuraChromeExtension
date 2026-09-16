(function () {
    if (window.__agentAuraIndicator) return
    window.__agentAuraIndicator = true

    let indicatorEl = null
    let timelineEl = null
    let isVisible = false

    function createIndicator() {
        indicatorEl = document.createElement('div')
        indicatorEl.id = 'agentaura-indicator'
        indicatorEl.innerHTML = `
            <div id="agentaura-indicator-inner">
                <div id="agentaura-pulse"></div>
                <span id="agentaura-status-text">AgentAura</span>
                <span id="agentaura-step-text"></span>
            </div>
            <div id="agentaura-timeline"></div>
        `

        const style = document.createElement('style')
        style.textContent = `
            #agentaura-indicator {
                position: fixed;
                top: 12px;
                right: 12px;
                z-index: 2147483647;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 12px;
                pointer-events: none;
                opacity: 0;
                transform: translateY(-8px);
                transition: opacity 0.3s, transform 0.3s;
            }
            #agentaura-indicator.visible {
                opacity: 1;
                transform: translateY(0);
                pointer-events: auto;
            }
            #agentaura-indicator-inner {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 14px;
                background: rgba(10, 10, 10, 0.92);
                border: 1px solid rgba(239, 83, 80, 0.3);
                border-radius: 24px;
                backdrop-filter: blur(12px);
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            }
            #agentaura-pulse {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #EF5350;
                flex-shrink: 0;
            }
            #agentaura-pulse.active {
                animation: aaPulse 1.5s ease-in-out infinite;
            }
            #agentaura-pulse.complete {
                background: #4CAF50;
                animation: none;
            }
            #agentaura-pulse.error {
                background: #EF5350;
                animation: none;
            }
            @keyframes aaPulse {
                0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239, 83, 80, 0.4); }
                50% { opacity: 0.6; box-shadow: 0 0 0 6px rgba(239, 83, 80, 0); }
            }
            #agentaura-status-text {
                color: #F5F5F5;
                font-weight: 600;
                font-size: 12px;
            }
            #agentaura-step-text {
                color: #888;
                font-size: 11px;
            }
            #agentaura-timeline {
                margin-top: 6px;
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.3s;
            }
            #agentaura-indicator.expanded #agentaura-timeline {
                max-height: 200px;
            }
            .aa-timeline-item {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 14px;
                font-size: 11px;
                color: #A0A0A0;
            }
            .aa-timeline-icon {
                width: 16px;
                height: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            .aa-timeline-icon.done { color: #4CAF50; }
            .aa-timeline-icon.running { color: #42A5F5; }
            .aa-timeline-icon.failed { color: #EF5350; }

            .aa-click-indicator {
                position: fixed;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: rgba(239, 83, 80, 0.4);
                border: 2px solid #EF5350;
                pointer-events: none;
                z-index: 2147483646;
                transform: translate(-50%, -50%);
                animation: aaClickPulse 0.6s ease-out forwards;
            }
            @keyframes aaClickPulse {
                0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
                100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
            }

            .aa-highlight-overlay {
                position: fixed;
                border: 2px solid #EF5350;
                background: rgba(239, 83, 80, 0.08);
                pointer-events: none;
                z-index: 2147483645;
                border-radius: 4px;
                transition: all 0.2s;
            }
        `

        document.documentElement.appendChild(style)
        document.documentElement.appendChild(indicatorEl)
        timelineEl = indicatorEl.querySelector('#agentaura-timeline')
    }

    function show(statusText, stepText) {
        if (!indicatorEl) createIndicator()
        const textEl = indicatorEl.querySelector('#agentaura-status-text')
        const stepEl = indicatorEl.querySelector('#agentaura-step-text')
        const pulseEl = indicatorEl.querySelector('#agentaura-pulse')

        textEl.textContent = statusText || 'AgentAura'
        stepEl.textContent = stepText || ''
        pulseEl.className = ''
        pulseEl.id = 'agentaura-pulse'
        pulseEl.classList.add('active')

        indicatorEl.classList.add('visible')
        isVisible = true
    }

    function hide() {
        if (indicatorEl) {
            indicatorEl.classList.remove('visible')
            isVisible = false
        }
    }

    function setComplete() {
        if (!indicatorEl) return
        const pulseEl = indicatorEl.querySelector('#agentaura-pulse')
        const textEl = indicatorEl.querySelector('#agentaura-status-text')
        pulseEl.className = ''
        pulseEl.id = 'agentaura-pulse'
        pulseEl.classList.add('complete')
        textEl.textContent = '任务完成'

        setTimeout(hide, 3000)
    }

    function setError(msg) {
        if (!indicatorEl) return
        const pulseEl = indicatorEl.querySelector('#agentaura-pulse')
        const textEl = indicatorEl.querySelector('#agentaura-status-text')
        pulseEl.className = ''
        pulseEl.id = 'agentaura-pulse'
        pulseEl.classList.add('error')
        textEl.textContent = msg || '操作失败'

        setTimeout(hide, 5000)
    }

    function addTimelineItem(icon, text, status) {
        if (!timelineEl) return
        const item = document.createElement('div')
        item.className = 'aa-timeline-item'
        item.innerHTML = `
            <span class="aa-timeline-icon ${status}">${icon}</span>
            <span>${text}</span>
        `
        timelineEl.appendChild(item)
        if (timelineEl.children.length > 8) {
            timelineEl.removeChild(timelineEl.firstChild)
        }
    }

    function showClickIndicator(x, y) {
        const el = document.createElement('div')
        el.className = 'aa-click-indicator'
        el.style.left = x + 'px'
        el.style.top = y + 'px'
        document.documentElement.appendChild(el)
        setTimeout(() => el.remove(), 600)
    }

    function highlightElement(selector) {
        try {
            const el = document.querySelector(selector)
            if (!el) return

            const rect = el.getBoundingClientRect()
            const overlay = document.createElement('div')
            overlay.className = 'aa-highlight-overlay'
            overlay.style.left = rect.left + 'px'
            overlay.style.top = rect.top + 'px'
            overlay.style.width = rect.width + 'px'
            overlay.style.height = rect.height + 'px'
            document.documentElement.appendChild(overlay)
            setTimeout(() => overlay.remove(), 1500)
        } catch (e) { }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'INDICATOR_SHOW':
                show(message.text || message.status || 'AgentAura', message.step)
                sendResponse({ success: true })
                break
            case 'INDICATOR_HIDE':
                hide()
                sendResponse({ success: true })
                break
            case 'INDICATOR_COMPLETE':
                setComplete()
                sendResponse({ success: true })
                break
            case 'INDICATOR_ERROR':
                setError(message.message)
                sendResponse({ success: true })
                break
            case 'INDICATOR_TIMELINE':
                addTimelineItem(message.icon || (message.success ? '✓' : '!'), message.text || message.action || '', message.status || (message.success ? 'done' : 'failed'))
                sendResponse({ success: true })
                break
            case 'INDICATOR_CLICK':
                showClickIndicator(message.x, message.y)
                sendResponse({ success: true })
                break
            case 'INDICATOR_HIGHLIGHT':
                highlightElement(message.selector)
                sendResponse({ success: true })
                break
        }
    })
})()
