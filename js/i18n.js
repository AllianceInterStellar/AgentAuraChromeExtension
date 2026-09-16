const I18n = (() => {
    const translations = {
        en: {
            // Sidepanel tabs
            'tab.chat': 'Chat',
            'tab.manage': 'Manage',

            // Topbar
            'topbar.shortcuts': 'Saved Shortcuts',
            'topbar.schedule': 'Scheduled Tasks',
            'topbar.export': 'Export Chat',
            'topbar.settings': 'Settings',
            'topbar.newChat': 'New Chat',

            // Permission modes
            'perm.ask': 'Ask',
            'perm.ask.title': 'Ask for approval before each action',
            'perm.act': 'Act',
            'perm.act.title': 'Execute actions and show results',
            'perm.plan': 'Plan',
            'perm.plan.title': 'Show execution plan, execute after approval',

            // Agent status
            'agent.working': 'Agent working...',
            'agent.step': 'Step {current} / {total}',
            'agent.step.prefix': 'Step ',
            'agent.step.mid': ' / ',
            'agent.step.suffix': '',
            'agent.stop': 'Stop',
            'agent.stop.title': 'Stop agent',
            'agent.tabCount': '{count} tabs',
            'agent.tabCount.one': '1 tab',

            // Empty state
            'empty.title': 'What can I do for you?',
            'empty.desc': 'I can browse the web, fill forms, click buttons, read pages, and automate tasks for you.',
            'empty.searchAI': 'Search & summarize AI news',
            'empty.checkEmail': 'Check email',
            'empty.fillForm': 'Fill this form',
            'empty.summarize': 'Summarize this page',
            'empty.searchAI.prompt': 'Search for the latest AI news and summarize',
            'empty.checkEmail.prompt': 'Open my email and check unread messages',
            'empty.fillForm.prompt': 'Fill the form on the current page with sample data',
            'empty.summarize.prompt': 'Read the current page and give me a summary',

            // Approval
            'approval.title': 'Action requires approval',
            'approval.deny': 'Deny',
            'approval.approve': 'Approve',
            'approval.approveAll': 'Approve All',

            // Plan
            'plan.title': 'Execution Plan',
            'plan.reject': 'Reject',
            'plan.execute': 'Execute Plan',

            // Shortcuts panel
            'shortcuts.title': 'Saved Shortcuts',
            'shortcuts.search': 'Search shortcuts...',
            'shortcuts.add': 'Add Shortcut',

            // Schedule panel
            'schedule.title': 'Scheduled Tasks',
            'schedule.interval': 'Interval (min):',
            'schedule.prompt': 'Enter scheduled task prompt...',
            'schedule.add': 'Add Scheduled Task',

            // Input area
            'input.selectClaw': 'Select instance...',
            'input.placeholder': 'Tell me what you want to do...',
            'input.screenshot': 'Include screenshot',
            'input.record': 'Record workflow',
            'input.send': 'Send',

            // Sidepanel system messages
            'sys.selectInstance': 'Please select a running instance first.',
            'sys.syncingSkill': 'Syncing browser automation prompt to instance...',
            'sys.skillSynced': 'Remote skill file synced; current session will use extension action protocol directly.',
            'sys.skillSyncFailed': 'Remote skill sync failed; current session will continue using extension action protocol.',
            'sys.gatewayFailed': 'Cannot connect to gateway, please check instance status.',
            'sys.connectionError': 'Connection error: {msg}',
            'sys.loopError': 'Loop error: {msg}',
            'sys.planRejected': 'Plan rejected, operation cancelled.',
            'sys.approvalTimeout': 'Action approval timeout: {action}',
            'sys.actionDenied': 'Action denied: {action}',
            'sys.actionFailed': 'Action failed: {error}',
            'sys.actionError': 'Action error: {msg}',
            'sys.maxRetries': 'Action still fails after multiple retries',
            'sys.maxRetriesFailed': 'Action still fails after multiple retries',
            'sys.retrying': '(retrying)',
            'sys.retryRecover': 'Action failed, recovering and retrying ({attempt}/{max}): {error}',
            'sys.stopped': 'Automation stopped.',
            'sys.screenshotCaptured': 'Screenshot captured, will attach to next message.',
            'sys.screenshotFailed': 'Screenshot failed.',
            'sys.screenshotError': 'Screenshot error: {msg}',
            'sys.recorded': 'Recorded {count} actions ({time}).',
            'sys.noRecorded': 'No actions recorded.',
            'sys.noRecording': 'No actions recorded.',
            'sys.noActiveTab': 'No active tab to record.',
            'sys.recordStarted': 'Recording started. Operate on the page, then click the record button again to stop.',
            'sys.recordingStarted': 'Recording started. Operate on the page, then click the record button again to stop.',
            'sys.recordError': 'Recording error: {msg}',
            'sys.noExport': 'Nothing to export.',
            'sys.noExportContent': 'Nothing to export.',
            'sys.exported': 'Chat exported.',
            'sys.exportError': 'Export error: {msg}',
            'sys.emptyShortcut': 'Please enter a prompt before saving as shortcut.',
            'sys.enterPromptFirst': 'Please enter a prompt before saving as shortcut.',
            'sys.shortcutSaved': 'Shortcut saved.',
            'sys.emptyTask': 'Please enter a task prompt.',
            'sys.enterTaskPrompt': 'Please enter a task prompt.',
            'sys.taskAdded': 'Task added, runs every {interval} minutes.',
            'sys.taskNoClaw': 'Scheduled task failed: no available instance.',
            'sys.taskNoInstance': 'Scheduled task failed: no available instance.',
            'sys.taskRunning': '⏰ Running scheduled task: {name}',
            'sys.taskExecuting': '⏰ Running scheduled task: {name}',

            'sys.screenshotAttached': 'Screenshot attached',
            'sys.connectError': 'Connection error: {msg}',
            'sys.executing': 'Executing: {action}',
            'sys.stepIndicator': 'Step {step}',
            'sys.attempt': 'Attempt {current}/{max}',
            'sys.noScheduledTasks': 'No scheduled tasks',
            'sys.enabled': 'Enabled',
            'sys.disabled': 'Disabled',
            'sys.delete': 'Delete',
            'sys.everyNMin': 'Every {n} min',
            'sys.ranCount': '{count} runs',
            'sys.lastRun': 'Last: ',
            'sys.sendFailed': 'Send failed: {msg}',
            'sys.noReply': 'No reply received',
            'sys.clawNotFound': 'Claw not found!',

            // Claw status
            'status.configuring': '(configuring)',
            'status.starting': '(starting)',
            'status.initializing': '(initializing)',
            'status.stopped': '(stopped)',
            'status.error': '(error)',

            // Context labels (system prompt)
            'ctx.untitledTab': 'Untitled tab',
            'ctx.chatHistory': 'Chat History',
            'ctx.user': 'User',
            'ctx.assistant': 'Assistant',
            'ctx.groupTabs': 'Tab Group',
            'ctx.currentTabId': 'Current tab ID',
            'ctx.unknown': 'unknown',
            'ctx.tab': 'Tab',
            'ctx.current': ' (current)',
            'ctx.pageState': 'Page State',
            'ctx.newTabNoContent': 'This is a browser new tab page, no operable content.',
            'ctx.title': 'Title',
            'ctx.screenshotAttachedJudge': 'Screenshot attached, use it to determine page state and element positions.',
            'ctx.screenshotAttachedVerify': 'Screenshot attached, use it to verify action results.',
            'ctx.screenshotAttachedRelocate': 'Screenshot attached, use it to relocate the issue.',
            'ctx.screenshotAttached': 'Screenshot attached.',
            'ctx.interactiveElements': 'Interactive Elements',
            'ctx.totalCount': '{count} total',
            'ctx.viewport': 'viewport',
            'ctx.headings': 'Headings',
            'ctx.forms': 'Forms',
            'ctx.buttons': 'Buttons',
            'ctx.cannotGetPageInfo': 'Cannot get page info.',
            'ctx.executedActions': 'Executed Actions',
            'ctx.specialPage': 'Browser special page.',
            'ctx.actionConstraint': 'Action Constraint',
            'ctx.onlyActionBlocks': 'To continue operating the browser, only output action code blocks. Do not call built-in browser tools.',
            'ctx.judgeNextStep': 'Please judge the task status and decide the next step.',
            'ctx.actionFailed': 'Action Failed',
            'ctx.failedAction': 'Failed action',
            'ctx.failedReason': 'Failure reason',
            'ctx.unknownError': 'unknown error',
            'ctx.noOperablePage': 'No operable page available.',
            'ctx.noBuiltinToolRecovery': 'Do not call built-in browser tools. Output new action code blocks or provide a completion summary.',
            'ctx.analyzeAndRetry': 'Please analyze the failure and try a different approach.',
            'ctx.systemCorrection': 'System Correction',
            'ctx.triedBuiltinTool': 'You just tried a built-in browser tool or reported a pairing/browser error.',
            'ctx.toolUnavailable': 'That tool is unavailable in this environment. Do not call it again.',
            'ctx.outputActionOrSummary': 'Based on the page info below, output the next action code block; or if the task is complete, output a text summary.',
            'ctx.previousReplySummary': 'Previous Reply Summary',
            'ctx.onlyReturnActionOrSummary': 'Please only return action code blocks or a final summary.',
            'ctx.elementNotFound': 'Element not found',
            'ctx.noResult': 'No result returned',
            'ctx.getPageTextFailed': 'Failed to get page text',

            // Auth screen
            'auth.welcome': 'Welcome to AgentAura',
            'auth.subtitle': 'Sign in to manage your OpenClaw instances',
            'auth.email': 'Email',
            'auth.emailPlaceholder': 'you@example.com',
            'auth.password': 'Password',
            'auth.passwordPlaceholder': '••••••••',
            'auth.signIn': 'Sign In',
            'auth.signUp': 'Create Account',
            'auth.or': 'or',
            'auth.guest': 'Continue as Guest',
            'auth.enterCredentials': 'Please enter email and password',
            'auth.passwordMin': 'Password must be at least 6 characters',
            'auth.signOut': 'Sign Out',
            'auth.signingIn': 'Signing in...',
            'auth.creatingAccount': 'Creating account...',
            'auth.createAccount': 'Create Account',
            'auth.linkGoogle': 'Bind Google Account',
            'auth.linkingGoogle': 'Connecting Google...',

            // Header
            'header.openAgent': 'Open Agent Panel',
            'header.refresh': 'Refresh',

            // Nav tabs
            'nav.claws': 'Claws',
            'nav.deploy': 'Deploy',
            'nav.chat': 'Chat',
            'nav.config': 'Config',
            'nav.storage': 'Storage',
            'nav.account': 'Account',

            // Claws page
            'claws.empty': 'No Claws Yet',
            'claws.emptyDesc': 'Deploy your first OpenClaw instance to get started',
            'claws.deployNow': 'Deploy Now',
            'claws.loadFailed': 'Failed to load',
            'claws.errorDefault': 'Something went wrong',
            'claws.retry': 'Retry',

            // Deploy page
            'deploy.name': 'Instance Name',
            'deploy.namePlaceholder': 'my-openclaw',
            'deploy.aiProvider': 'AI Provider',
            'deploy.aiModel': 'AI Model',
            'deploy.selectProvider': 'Select a provider first',
            'deploy.cloudProvider': 'Cloud Provider',
            'deploy.plan': 'Plan',
            'deploy.region': 'Region',
            'deploy.method': 'Deployment Method',
            'deploy.npm': 'NPM (Recommended)',
            'deploy.docker': 'Docker',
            'deploy.button': 'Deploy OpenClaw',
            'deploy.deploying': 'Deploying...',
            'deploy.cancel': 'Cancel Deployment',
            'deploy.viewClaws': 'View My Claws',

            // Chat page (popup)
            'chat.empty': 'How can I help you?',
            'chat.emptyDesc': 'Send a message to start chatting with your OpenClaw AI assistant',
            'chat.noClaw': 'No instance selected',
            'chat.noClawDesc': 'Go to the Claws tab and click the "Chat" button on a running instance',
            'chat.viewInstances': 'View Instances',
            'chat.inputPlaceholder': 'Send a message...',
            'chat.newSession': 'New Session',
            'chat.backToClaws': 'Back to Claws',
            'chat.gatewayFailed': 'Cannot connect to gateway',
            'chat.sendFailed': 'Send failed: {msg}',
            'chat.clawNotFound': 'Claw not found!',

            // Config page
            'config.aiKeys': 'AI API Keys',
            'config.aiKeysDesc': 'Configure your AI provider API keys for deploying OpenClaw with your preferred model.',
            'config.providerTokens': 'Provider API Tokens',
            'config.providerTokensDesc': 'Configure your cloud provider API tokens to deploy OpenClaw instances.',

            // Storage page
            'storage.title': 'Cloud Storage',
            'storage.desc': 'Configure cloud storage remotes for persistent data backup and mount to your instances.',
            'storage.empty': 'No Storage Remotes',
            'storage.emptyDesc': 'Add a cloud storage remote to enable persistent backups',
            'storage.addRemote': 'Add Storage Remote',
            'storage.modalTitle': 'Add Storage Remote',
            'storage.remoteName': 'Remote Name',
            'storage.remoteNamePlaceholder': 'my-backup',
            'storage.remoteType': 'Storage Type',
            'storage.selectType': 'Select a type...',
            'storage.cancel': 'Cancel',
            'storage.save': 'Save Remote',

            // Account page
            'account.title': 'Account',
            'account.loading': 'Loading...',
            'account.guest': '👤 Guest Account',
            'account.signedIn': '✓ Signed In',
            'account.googleLinked': '✓ Google Linked',
            'account.anonymousSession': 'Anonymous session',
            'account.version': 'AgentAura Chrome Extension v3.0.0',

            // Toast messages
            'toast.instanceStarting': 'Instance starting...',
            'toast.instanceStopped': 'Instance stopped.',
            'toast.instanceRestarting': 'Instance restarting...',
            'toast.instanceDeleted': 'Instance deleted.',
            'toast.unmountFailed': 'Failed to unmount storage!',
            'toast.unmounted': 'Storage unmounted.',
            'toast.deployStarted': 'Deployment started!',
            'toast.deployComplete': 'Deployment complete!',
            'toast.deployFailed': 'Deployment failed!',
            'toast.deployCancelled': 'Deployment cancelled.',
            'toast.configSaved': 'Configuration saved locally.',
            'toast.enterToken': 'Please enter a token first!',
            'toast.configSynced': 'Configuration synced to cloud.',
            'toast.syncFailed': 'Sync failed!',
            'toast.pasted': 'Pasted from clipboard.',
            'toast.clipboardFailed': 'Cannot access clipboard!',
            'toast.copied': 'Copied to clipboard!',
            'toast.noModel': 'No model selected for this instance!',
            'toast.invalidProvider': 'Invalid AI provider!',
            'toast.aiConfigApplied': 'AI config applied to server.',
            'toast.aiConfigFailed': 'Failed to apply AI config!',
            'toast.syncError': 'Sync error: {msg}',
            'toast.noStorageRemotes': 'No storage remotes configured. Go to Storage tab to add one.',
            'toast.storageMounted': 'Storage mounted.',
            'toast.mountFailed': 'Failed to mount storage!',
            'toast.fillNameType': 'Please fill in name and type!',
            'toast.fillField': 'Please fill in {label}!',
            'toast.remoteUpdated': 'Remote updated.',
            'toast.remoteAdded': 'Remote added.',
            'toast.remoteDeleted': 'Remote deleted.',
            'toast.syncing': 'Syncing...',
            'toast.syncStarted': 'Sync started.',
            'toast.syncNeedsRunningClaw': 'Sync needs a running instance — start a Claw first.',
            'storage.pickClawTitle': 'Select instance to run sync',
            'toast.enterEmailPassword': 'Please enter email and password',
            'toast.passwordMinLength': 'Password must be at least 6 characters',
            'toast.googleLinked': 'Google account linked.',
            'toast.storageUnmounted': 'Storage unmounted.',
            'toast.storageUnmountFailed': 'Failed to unmount storage!',
            'toast.enterTokenFirst': 'Please enter a token first!',
            'toast.pastedClipboard': 'Pasted from clipboard.',
            'toast.copiedClipboard': 'Copied to clipboard!',
            'toast.noModelSelected': 'No model selected for this instance!',
            'toast.invalidAIProvider': 'Invalid AI provider!',
            'toast.storageMountFailed': 'Failed to mount storage!',
            'toast.fillNameAndType': 'Please fill in name and type!',
            'toast.confirmDeleteRemote': 'Delete this storage remote?',

            // Options page
            'options.title': 'AgentAura Settings',
            'options.subtitle': 'Configure your browser automation agent',
            'options.permMode': 'Default Permission Mode',
            'options.askLabel': 'Ask Before Acting',
            'options.askDesc': 'Approve each action',
            'options.actLabel': 'Act Before Asking',
            'options.actDesc': 'Act, then show results',
            'options.planLabel': 'Follow a Plan',
            'options.planDesc': 'Approve complete plan',
            'options.safety': 'Safety',
            'options.blockSites': 'Block Sensitive Sites',
            'options.blockSitesDesc': 'Prevent agent from accessing banking, government, and auth pages',
            'options.tabGroup': 'Tab Group Isolation',
            'options.tabGroupDesc': 'Agent can only interact with tabs in its group',
            'options.limits': 'Limits',
            'options.maxSteps': 'Max Steps Per Task',
            'options.maxStepsDesc': 'Maximum actions the agent can take in a single task',
            'options.screenshotQuality': 'Screenshot Quality',
            'options.screenshotQualityDesc': 'Quality percentage for captured screenshots',
            'options.dev': 'Development',
            'options.apiUrl': 'API Base URL',
            'options.apiUrlDesc': 'Override API endpoint for local development. Leave empty for production (d1em8r2hdbckr6.cloudfront.net)',
            'options.shortcuts': 'Saved Shortcuts',
            'options.tasks': 'Scheduled Tasks',
            'options.save': 'Save Settings',
            'options.saved': 'Settings saved!',
            'options.version': 'AgentAura v3.0.0',
            'options.loading': 'Loading...',
            'options.noShortcuts': 'No saved shortcuts',
            'options.noTasks': 'No scheduled tasks',
            'options.uses': '{count} uses',
            'options.every': 'Every {interval} min',
            'options.language': 'Language',
            'options.langLabel': 'Interface Language',
            'options.langDesc': 'Choose the display language for the extension',
            'options.languageDesc': 'Interface display language',
            'options.runs': 'runs',
            'options.active': 'Active',
            'options.paused': 'Paused',
            'options.uses': 'uses',

            'ui.running': 'Running',
            'ui.configuring': 'Configuring',
            'ui.starting': 'Starting',
            'ui.stopped': 'Stopped',
            'ui.error': 'Error',
            'ui.unknown': 'Unknown',
            'ui.storage': 'Storage',
            'ui.mounted': 'Mounted',
            'ui.notMounted': 'Not Mounted',
            'ui.mount': 'Mount',
            'ui.unmount': 'Unmount',
            'ui.mounting': 'Mounting...',
            'ui.unmounting': 'Unmounting...',
            'ui.start': 'Start',
            'ui.stop': 'Stop',
            'ui.restart': 'Restart',
            'ui.delete': 'Delete',
            'ui.gateway': 'Gateway',
            'ui.copyIp': 'Copy IP',
            'ui.openclawInstance': 'OpenClaw Instance',
            'ui.thisInstance': 'this instance',
            'ui.tapToSelectModel': 'Tap to select model',
            'ui.custom': 'Custom',
            'ui.resetToDefault': 'Reset to default',
            'ui.syncing': 'Syncing...',
            'ui.applyAiConfig': 'Apply AI Config',
            'ui.selectStorageRemote': 'Select Storage Remote',
            'ui.confirmDeleteInstance': 'Delete "{name}"? This action cannot be undone.',
            'ui.confirmUnmountStorage': 'Unmount storage from "{name}"?',
            'ui.failedCreateInstance': 'Failed to create instance',
            'ui.deploying': 'Deploying...',
            'deploy.stepCreateServer': 'Creating server',
            'deploy.stepWaitServer': 'Waiting for server',
            'deploy.stepConnectSsh': 'Connecting via SSH',
            'deploy.stepInstallDeps': 'Installing dependencies',
            'deploy.stepDeployOpenClaw': 'Deploying OpenClaw',
            'deploy.stepConfigureGateway': 'Configuring gateway',
            'deploy.stepSetupSsl': 'Setting up SSL',
            'deploy.stepFinalizing': 'Finalizing'
        },
        zh: {
            // Sidepanel tabs
            'tab.chat': '聊天',
            'tab.manage': '管理',

            // Topbar
            'topbar.shortcuts': '已保存的快捷提示',
            'topbar.schedule': '定时任务',
            'topbar.export': '导出对话',
            'topbar.settings': '设置',
            'topbar.newChat': '新对话',

            // Permission modes
            'perm.ask': '询问',
            'perm.ask.title': '每个操作前询问确认',
            'perm.act': '执行',
            'perm.act.title': '直接执行操作并展示结果',
            'perm.plan': '计划',
            'perm.plan.title': '先展示执行计划，批准后执行',

            // Agent status
            'agent.working': '智能体工作中...',
            'agent.step': '第 {current} 步 / 共 {total} 步',
            'agent.step.prefix': '第 ',
            'agent.step.mid': ' 步 / 共 ',
            'agent.step.suffix': ' 步',
            'agent.stop': '停止',
            'agent.stop.title': '停止智能体',
            'agent.tabCount': '{count} 个标签页',
            'agent.tabCount.one': '1 个标签页',

            // Empty state
            'empty.title': '你需要我做什么？',
            'empty.desc': '我可以浏览网页、填写表单、点击按钮、阅读页面，并为你自动化各种任务。',
            'empty.searchAI': '搜索并总结AI新闻',
            'empty.checkEmail': '检查邮件',
            'empty.fillForm': '填写此表单',
            'empty.summarize': '总结此页面',
            'empty.searchAI.prompt': '搜索最新的AI新闻并总结',
            'empty.checkEmail.prompt': '打开我的邮箱检查未读邮件',
            'empty.fillForm.prompt': '用示例数据填写当前页面的表单',
            'empty.summarize.prompt': '阅读当前页面并给我一份摘要',

            // Approval
            'approval.title': '操作需要审批',
            'approval.deny': '拒绝',
            'approval.approve': '批准',
            'approval.approveAll': '全部批准',

            // Plan
            'plan.title': '执行计划',
            'plan.reject': '拒绝',
            'plan.execute': '执行计划',

            // Shortcuts panel
            'shortcuts.title': '已保存的快捷提示',
            'shortcuts.search': '搜索快捷提示...',
            'shortcuts.add': '添加快捷提示',

            // Schedule panel
            'schedule.title': '定时任务',
            'schedule.interval': '间隔 (分钟):',
            'schedule.prompt': '输入定时任务提示词...',
            'schedule.add': '添加定时任务',

            // Input area
            'input.selectClaw': '选择实例...',
            'input.placeholder': '告诉我你想做什么...',
            'input.screenshot': '包含截图',
            'input.record': '录制工作流',
            'input.send': '发送',

            // Sidepanel system messages
            'sys.selectInstance': '请先选择一个运行中的实例。',
            'sys.syncingSkill': '正在同步浏览器自动化提示到实例...',
            'sys.skillSynced': '已同步远端技能文件；当前会话将直接使用扩展动作协议。',
            'sys.skillSyncFailed': '远端技能同步失败；当前会话将继续使用扩展动作协议。',
            'sys.gatewayFailed': '无法连接到网关，请检查实例状态。',
            'sys.connectionError': '连接错误: {msg}',
            'sys.loopError': '循环错误: {msg}',
            'sys.planRejected': '计划被拒绝，操作已取消。',
            'sys.approvalTimeout': '操作审批超时: {action}',
            'sys.actionDenied': '操作被拒绝: {action}',
            'sys.actionFailed': '操作失败: {error}',
            'sys.actionError': '操作错误: {msg}',
            'sys.maxRetries': '操作多次重试后仍然失败',
            'sys.maxRetriesFailed': '操作多次重试后仍然失败',
            'sys.retrying': '（重试中）',
            'sys.retryRecover': '操作失败，正在恢复后重试（{attempt}/{max}）：{error}',
            'sys.stopped': '已停止自动化操作。',
            'sys.screenshotCaptured': '截图已捕获，将附加到下一条消息中。',
            'sys.screenshotFailed': '截图失败。',
            'sys.screenshotError': '截图错误: {msg}',
            'sys.recorded': '已录制 {count} 个操作 ({time})。',
            'sys.noRecorded': '未录制到任何操作。',
            'sys.noRecording': '未录制到任何操作。',
            'sys.noActiveTab': '没有活跃标签页可录制。',
            'sys.recordStarted': '录制已开始。在页面上操作，完成后再次点击录制按钮停止。',
            'sys.recordingStarted': '录制已开始。在页面上操作，完成后再次点击录制按钮停止。',
            'sys.recordError': '录制错误: {msg}',
            'sys.noExport': '没有可导出的内容。',
            'sys.noExportContent': '没有可导出的内容。',
            'sys.exported': '对话已导出。',
            'sys.exportError': '导出错误: {msg}',
            'sys.emptyShortcut': '请先输入提示词，再保存为快捷方式。',
            'sys.enterPromptFirst': '请先输入提示词，再保存为快捷方式。',
            'sys.shortcutSaved': '快捷方式已保存。',
            'sys.emptyTask': '请输入任务提示词。',
            'sys.enterTaskPrompt': '请输入任务提示词。',
            'sys.taskAdded': '定时任务已添加，每 {interval} 分钟执行一次。',
            'sys.taskNoClaw': '定时任务执行失败: 没有可用实例。',
            'sys.taskNoInstance': '定时任务执行失败: 没有可用实例。',
            'sys.taskRunning': '⏰ 执行定时任务: {name}',
            'sys.taskExecuting': '⏰ 执行定时任务: {name}',

            'sys.screenshotAttached': '已附加截图',
            'sys.connectError': '连接错误: {msg}',
            'sys.executing': '执行: {action}',
            'sys.stepIndicator': '第 {step} 步',
            'sys.attempt': '尝试 {current}/{max}',
            'sys.noScheduledTasks': '暂无定时任务',
            'sys.enabled': '已启用',
            'sys.disabled': '已禁用',
            'sys.delete': '删除',
            'sys.everyNMin': '每 {n} 分钟',
            'sys.ranCount': '{count} 次',
            'sys.lastRun': '上次: ',
            'sys.sendFailed': '发送失败: {msg}',
            'sys.noReply': '未收到回复',
            'sys.clawNotFound': '未找到实例！',

            // Claw status
            'status.configuring': '(配置中)',
            'status.starting': '(启动中)',
            'status.initializing': '(初始化)',
            'status.stopped': '(已停止)',
            'status.error': '(错误)',

            // Context labels (system prompt)
            'ctx.untitledTab': '未命名标签',
            'ctx.chatHistory': '对话历史',
            'ctx.user': '用户',
            'ctx.assistant': '助手',
            'ctx.groupTabs': '分组标签页',
            'ctx.currentTabId': '当前标签ID',
            'ctx.unknown': '未知',
            'ctx.tab': '标签',
            'ctx.current': '（当前）',
            'ctx.pageState': '页面状态',
            'ctx.newTabNoContent': '当前是浏览器新标签页，无可操作内容。',
            'ctx.title': '标题',
            'ctx.screenshotAttachedJudge': '已附加当前页面截图，请结合截图判断页面状态和元素位置。',
            'ctx.screenshotAttachedVerify': '已附加当前页面截图，请结合截图确认操作结果。',
            'ctx.screenshotAttachedRelocate': '已附加当前页面截图，请结合截图重新定位问题。',
            'ctx.screenshotAttached': '已附加当前页面截图。',
            'ctx.interactiveElements': '可交互元素',
            'ctx.totalCount': '共{count}个',
            'ctx.viewport': '视口',
            'ctx.headings': '标题',
            'ctx.forms': '表单',
            'ctx.buttons': '按钮',
            'ctx.cannotGetPageInfo': '无法获取页面信息。',
            'ctx.executedActions': '已执行操作',
            'ctx.specialPage': '浏览器特殊页面。',
            'ctx.actionConstraint': '动作约束',
            'ctx.onlyActionBlocks': '如需继续操作浏览器，只能输出 action 代码块，禁止调用内置 browser 工具。',
            'ctx.judgeNextStep': '请判断任务状态并决定下一步。',
            'ctx.actionFailed': '操作失败',
            'ctx.failedAction': '失败动作',
            'ctx.failedReason': '失败原因',
            'ctx.unknownError': '未知错误',
            'ctx.noOperablePage': '当前没有可操作页面。',
            'ctx.noBuiltinToolRecovery': '禁止调用内置 browser 工具。只输出新的 action 代码块或直接给出完成总结。',
            'ctx.analyzeAndRetry': '请分析失败原因并尝试其他方法。',
            'ctx.systemCorrection': '系统纠正',
            'ctx.triedBuiltinTool': '你刚才尝试了内置 browser 工具或报告了 pairing/browser 错误。',
            'ctx.toolUnavailable': '该工具在当前环境不可用。不要再次调用它。',
            'ctx.outputActionOrSummary': '请基于下面页面信息，直接输出下一步 action 代码块；如果任务已完成，则直接输出文字总结。',
            'ctx.previousReplySummary': '上一条回复摘要',
            'ctx.onlyReturnActionOrSummary': '请只返回 action 代码块或最终总结。',
            'ctx.elementNotFound': '未找到元素',
            'ctx.noResult': '无返回结果',
            'ctx.getPageTextFailed': '获取页面文本失败',

            // Auth screen
            'auth.welcome': '欢迎使用 AgentAura',
            'auth.subtitle': '登录以管理你的 OpenClaw 实例',
            'auth.email': '邮箱',
            'auth.emailPlaceholder': 'you@example.com',
            'auth.password': '密码',
            'auth.passwordPlaceholder': '••••••••',
            'auth.signIn': '登录',
            'auth.signUp': '创建账户',
            'auth.or': '或',
            'auth.guest': '游客模式继续',
            'auth.enterCredentials': '请输入邮箱和密码',
            'auth.passwordMin': '密码至少6个字符',
            'auth.signOut': '退出登录',
            'auth.signingIn': '登录中...',
            'auth.creatingAccount': '创建账户中...',
            'auth.createAccount': '创建账户',

            // Header
            'header.openAgent': '打开智能体面板',
            'header.refresh': '刷新',

            // Nav tabs
            'nav.claws': '实例',
            'nav.deploy': '部署',
            'nav.chat': '对话',
            'nav.config': '配置',
            'nav.storage': '存储',
            'nav.account': '账户',

            // Claws page
            'claws.empty': '还没有实例',
            'claws.emptyDesc': '部署你的第一个 OpenClaw 实例开始使用',
            'claws.deployNow': '立即部署',
            'claws.loadFailed': '加载失败',
            'claws.errorDefault': '出错了',
            'claws.retry': '重试',

            // Deploy page
            'deploy.name': '实例名称',
            'deploy.namePlaceholder': 'my-openclaw',
            'deploy.aiProvider': 'AI 提供商',
            'deploy.aiModel': 'AI 模型',
            'deploy.selectProvider': '请先选择提供商',
            'deploy.cloudProvider': '云服务商',
            'deploy.plan': '套餐',
            'deploy.region': '地区',
            'deploy.method': '部署方式',
            'deploy.npm': 'NPM（推荐）',
            'deploy.docker': 'Docker',
            'deploy.button': '部署 OpenClaw',
            'deploy.deploying': '部署中...',
            'deploy.cancel': '取消部署',
            'deploy.viewClaws': '查看我的实例',

            // Chat page (popup)
            'chat.empty': '有什么可以帮你的？',
            'chat.emptyDesc': '发送消息，开始与你的 OpenClaw AI 助手对话',
            'chat.noClaw': '未选择实例',
            'chat.noClawDesc': '前往 Claws 标签页，点击运行中实例的「Chat」按钮',
            'chat.viewInstances': '查看实例',
            'chat.inputPlaceholder': '发送消息...',
            'chat.newSession': '新对话',
            'chat.backToClaws': '返回实例',
            'chat.gatewayFailed': '无法连接到网关',
            'chat.sendFailed': '发送失败: {msg}',
            'chat.clawNotFound': '未找到实例！',

            // Config page
            'config.aiKeys': 'AI API 密钥',
            'config.aiKeysDesc': '配置你的 AI 提供商 API 密钥，用于部署 OpenClaw 时使用你偏好的模型。',
            'config.providerTokens': '云服务商 API Token',
            'config.providerTokensDesc': '配置云服务商 API Token 以部署 OpenClaw 实例。',

            // Storage page
            'storage.title': '云存储',
            'storage.desc': '配置云存储远程，用于持久数据备份并挂载到实例。',
            'storage.empty': '没有存储远程',
            'storage.emptyDesc': '添加云存储远程以启用持久备份',
            'storage.addRemote': '添加存储远程',
            'storage.modalTitle': '添加存储远程',
            'storage.remoteName': '远程名称',
            'storage.remoteNamePlaceholder': 'my-backup',
            'storage.remoteType': '存储类型',
            'storage.selectType': '选择类型...',
            'storage.cancel': '取消',
            'storage.save': '保存远程',

            // Account page
            'account.title': '账户',
            'account.loading': '加载中...',
            'account.guest': '👤 游客账户',
            'account.signedIn': '✓ 已登录',
            'account.version': 'AgentAura 浏览器扩展 v3.0.0',

            // Toast messages
            'toast.instanceStarting': '正在启动实例...',
            'toast.instanceStopped': '实例已停止。',
            'toast.instanceRestarting': '正在重启实例...',
            'toast.instanceDeleted': '实例已删除。',
            'toast.unmountFailed': '卸载存储失败！',
            'toast.unmounted': '存储已卸载。',
            'toast.deployStarted': '部署已开始！',
            'toast.deployComplete': '部署完成！',
            'toast.deployFailed': '部署失败！',
            'toast.deployCancelled': '部署已取消。',
            'toast.configSaved': '配置已保存到本地。',
            'toast.enterToken': '请先输入 Token！',
            'toast.configSynced': '配置已同步到云端。',
            'toast.syncFailed': '同步失败！',
            'toast.pasted': '已粘贴。',
            'toast.clipboardFailed': '无法访问剪贴板！',
            'toast.copied': '已复制到剪贴板！',
            'toast.noModel': '未为此实例选择模型！',
            'toast.invalidProvider': '无效的 AI 提供商！',
            'toast.aiConfigApplied': 'AI 配置已应用到服务器。',
            'toast.aiConfigFailed': '应用 AI 配置失败！',
            'toast.syncError': '同步错误: {msg}',
            'toast.noStorageRemotes': '未配置存储远程。前往存储标签页添加。',
            'toast.storageMounted': '存储已挂载。',
            'toast.mountFailed': '挂载存储失败！',
            'toast.fillNameType': '请填写名称和类型！',
            'toast.fillField': '请填写 {label}！',
            'toast.remoteUpdated': '远程已更新。',
            'toast.remoteAdded': '远程已添加。',
            'toast.remoteDeleted': '远程已删除。',
            'toast.syncing': '同步中...',
            'toast.syncStarted': '同步已开始。',
            'toast.syncNeedsRunningClaw': '同步需要一个运行中的实例，请先启动 Claw。',
            'storage.pickClawTitle': '选择执行同步的实例',
            'toast.enterEmailPassword': '请输入邮箱和密码',
            'toast.passwordMinLength': '密码至少6个字符',
            'toast.storageUnmounted': '存储已卸载。',
            'toast.storageUnmountFailed': '卸载存储失败！',
            'toast.enterTokenFirst': '请先输入 Token！',
            'toast.pastedClipboard': '已粘贴。',
            'toast.copiedClipboard': '已复制到剪贴板！',
            'toast.noModelSelected': '未为此实例选择模型！',
            'toast.invalidAIProvider': '无效的 AI 提供商！',
            'toast.storageMountFailed': '挂载存储失败！',
            'toast.fillNameAndType': '请填写名称和类型！',
            'toast.confirmDeleteRemote': '确定删除此存储远程？',

            // Options page
            'options.title': 'AgentAura 设置',
            'options.subtitle': '配置你的浏览器自动化智能体',
            'options.permMode': '默认权限模式',
            'options.askLabel': '先询问再操作',
            'options.askDesc': '每个操作前确认',
            'options.actLabel': '先操作再询问',
            'options.actDesc': '执行后展示结果',
            'options.planLabel': '按计划执行',
            'options.planDesc': '批准完整计划',
            'options.safety': '安全',
            'options.blockSites': '屏蔽敏感网站',
            'options.blockSitesDesc': '阻止智能体访问银行、政府和认证页面',
            'options.tabGroup': '标签组隔离',
            'options.tabGroupDesc': '智能体只能与其分组内的标签页交互',
            'options.limits': '限制',
            'options.maxSteps': '每个任务最大步数',
            'options.maxStepsDesc': '智能体在单个任务中可执行的最大操作数',
            'options.screenshotQuality': '截图质量',
            'options.screenshotQualityDesc': '截图的质量百分比',
            'options.dev': '开发',
            'options.apiUrl': 'API 基础 URL',
            'options.apiUrlDesc': '覆盖 API 端点用于本地开发。留空使用生产环境 (d1em8r2hdbckr6.cloudfront.net)',
            'options.shortcuts': '已保存的快捷提示',
            'options.tasks': '定时任务',
            'options.save': '保存设置',
            'options.saved': '设置已保存！',
            'options.version': 'AgentAura v3.0.0',
            'options.loading': '加载中...',
            'options.noShortcuts': '暂无保存的快捷提示',
            'options.noTasks': '暂无定时任务',
            'options.uses': '使用 {count} 次',
            'options.every': '每 {interval} 分钟',
            'options.language': '语言',
            'options.langLabel': '界面语言',
            'options.langDesc': '选择扩展的显示语言',
            'options.languageDesc': '界面显示语言',
            'options.runs': '次',
            'options.active': '已启用',
            'options.paused': '已暂停',
            'options.uses': '次',

            'ui.running': '运行中',
            'ui.configuring': '配置中',
            'ui.starting': '启动中',
            'ui.stopped': '已停止',
            'ui.error': '错误',
            'ui.unknown': '未知',
            'ui.storage': '存储',
            'ui.mounted': '已挂载',
            'ui.notMounted': '未挂载',
            'ui.mount': '挂载',
            'ui.unmount': '卸载',
            'ui.mounting': '挂载中...',
            'ui.unmounting': '卸载中...',
            'ui.start': '启动',
            'ui.stop': '停止',
            'ui.restart': '重启',
            'ui.delete': '删除',
            'ui.gateway': '网关',
            'ui.copyIp': '复制 IP',
            'ui.openclawInstance': 'OpenClaw 实例',
            'ui.thisInstance': '该实例',
            'ui.tapToSelectModel': '点击选择模型',
            'ui.custom': '自定义',
            'ui.resetToDefault': '恢复默认',
            'ui.syncing': '同步中...',
            'ui.applyAiConfig': '应用 AI 配置',
            'ui.selectStorageRemote': '选择存储远程',
            'ui.confirmDeleteInstance': '确定删除“{name}”？此操作无法撤销。',
            'ui.confirmUnmountStorage': '确定从“{name}”卸载存储？',
            'ui.failedCreateInstance': '创建实例失败',
            'ui.deploying': '部署中...',
            'deploy.stepCreateServer': '创建服务器',
            'deploy.stepWaitServer': '等待服务器就绪',
            'deploy.stepConnectSsh': '连接 SSH',
            'deploy.stepInstallDeps': '安装依赖',
            'deploy.stepDeployOpenClaw': '部署 OpenClaw',
            'deploy.stepConfigureGateway': '配置网关',
            'deploy.stepSetupSsl': '配置 SSL',
            'deploy.stepFinalizing': '收尾中'
        }
    }

    const englishFallbackLanguages = ['ar', 'de', 'es', 'es-419', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr']

    englishFallbackLanguages.forEach((lang) => {
        translations[lang] = { ...translations.en }
    })

    const localizedOverrides = {
        ar: {
            'auth.signIn': 'تسجيل الدخول',
            'auth.signUp': 'إنشاء حساب',
            'auth.guest': 'المتابعة كضيف',
            'nav.claws': 'الخوادم',
            'nav.deploy': 'النشر',
            'nav.chat': 'الدردشة',
            'nav.config': 'الإعدادات',
            'nav.storage': 'التخزين',
            'nav.account': 'الحساب',
            'options.title': 'إعدادات AgentAura',
            'options.subtitle': 'تكوين وكيل أتمتة المتصفح',
            'options.langLabel': 'لغة الواجهة',
            'options.langDesc': 'اختر لغة عرض الإضافة',
            'options.save': 'حفظ الإعدادات',
            'options.saved': 'تم حفظ الإعدادات!',
            'deploy.button': 'نشر OpenClaw',
            'claws.deployNow': 'انشر الآن',
            'storage.addRemote': 'إضافة وحدة تخزين',
            'chat.newSession': 'محادثة جديدة',
            'header.refresh': 'تحديث'
        },
        de: {
            'auth.signIn': 'Anmelden',
            'auth.signUp': 'Konto erstellen',
            'auth.guest': 'Als Gast fortfahren',
            'nav.claws': 'Instanzen',
            'nav.deploy': 'Bereitstellen',
            'nav.chat': 'Chat',
            'nav.config': 'Konfiguration',
            'nav.storage': 'Speicher',
            'nav.account': 'Konto',
            'options.title': 'AgentAura Einstellungen',
            'options.subtitle': 'Browser-Automatisierungsagent konfigurieren',
            'options.langLabel': 'Oberflächensprache',
            'options.langDesc': 'Anzeigesprache der Erweiterung wählen',
            'options.save': 'Einstellungen speichern',
            'options.saved': 'Einstellungen gespeichert!',
            'deploy.button': 'OpenClaw bereitstellen',
            'claws.deployNow': 'Jetzt bereitstellen',
            'storage.addRemote': 'Speicher hinzufügen',
            'chat.newSession': 'Neue Sitzung',
            'header.refresh': 'Aktualisieren'
        },
        es: {
            'auth.signIn': 'Iniciar sesión',
            'auth.signUp': 'Crear cuenta',
            'auth.guest': 'Continuar como invitado',
            'nav.claws': 'Instancias',
            'nav.deploy': 'Desplegar',
            'nav.chat': 'Chat',
            'nav.config': 'Configuración',
            'nav.storage': 'Almacenamiento',
            'nav.account': 'Cuenta',
            'options.title': 'Configuración de AgentAura',
            'options.subtitle': 'Configura tu agente de automatización del navegador',
            'options.langLabel': 'Idioma de la interfaz',
            'options.langDesc': 'Elige el idioma de la extensión',
            'options.save': 'Guardar ajustes',
            'options.saved': '¡Ajustes guardados!',
            'deploy.button': 'Desplegar OpenClaw',
            'claws.deployNow': 'Desplegar ahora',
            'storage.addRemote': 'Agregar almacenamiento',
            'chat.newSession': 'Nueva sesión',
            'header.refresh': 'Actualizar'
        },
        'es-419': {
            'auth.signIn': 'Iniciar sesión',
            'auth.signUp': 'Crear cuenta',
            'auth.guest': 'Continuar como invitado',
            'nav.claws': 'Instancias',
            'nav.deploy': 'Implementar',
            'nav.chat': 'Chat',
            'nav.config': 'Configuración',
            'nav.storage': 'Almacenamiento',
            'nav.account': 'Cuenta',
            'options.title': 'Configuración de AgentAura',
            'options.subtitle': 'Configura tu agente de automatización del navegador',
            'options.langLabel': 'Idioma de la interfaz',
            'options.langDesc': 'Elige el idioma de la extensión',
            'options.save': 'Guardar configuración',
            'options.saved': '¡Configuración guardada!',
            'deploy.button': 'Implementar OpenClaw',
            'claws.deployNow': 'Implementar ahora',
            'storage.addRemote': 'Agregar almacenamiento',
            'chat.newSession': 'Nueva sesión',
            'header.refresh': 'Actualizar'
        },
        fr: {
            'auth.signIn': 'Se connecter',
            'auth.signUp': 'Créer un compte',
            'auth.guest': 'Continuer en invité',
            'nav.claws': 'Instances',
            'nav.deploy': 'Déployer',
            'nav.chat': 'Chat',
            'nav.config': 'Configuration',
            'nav.storage': 'Stockage',
            'nav.account': 'Compte',
            'options.title': 'Paramètres AgentAura',
            'options.subtitle': 'Configurez votre agent d’automatisation du navigateur',
            'options.langLabel': 'Langue de l’interface',
            'options.langDesc': 'Choisissez la langue affichée de l’extension',
            'options.save': 'Enregistrer',
            'options.saved': 'Paramètres enregistrés !',
            'deploy.button': 'Déployer OpenClaw',
            'claws.deployNow': 'Déployer maintenant',
            'storage.addRemote': 'Ajouter un stockage',
            'chat.newSession': 'Nouvelle session',
            'header.refresh': 'Actualiser'
        },
        it: {
            'auth.signIn': 'Accedi',
            'auth.signUp': 'Crea account',
            'auth.guest': 'Continua come ospite',
            'nav.claws': 'Istanze',
            'nav.deploy': 'Distribuisci',
            'nav.chat': 'Chat',
            'nav.config': 'Configurazione',
            'nav.storage': 'Archiviazione',
            'nav.account': 'Account',
            'options.title': 'Impostazioni AgentAura',
            'options.subtitle': 'Configura il tuo agente di automazione del browser',
            'options.langLabel': 'Lingua interfaccia',
            'options.langDesc': 'Scegli la lingua di visualizzazione dell’estensione',
            'options.save': 'Salva impostazioni',
            'options.saved': 'Impostazioni salvate!',
            'deploy.button': 'Distribuisci OpenClaw',
            'claws.deployNow': 'Distribuisci ora',
            'storage.addRemote': 'Aggiungi archiviazione',
            'chat.newSession': 'Nuova sessione',
            'header.refresh': 'Aggiorna'
        },
        ja: {
            'auth.signIn': 'ログイン',
            'auth.signUp': 'アカウント作成',
            'auth.guest': 'ゲストとして続行',
            'nav.claws': 'インスタンス',
            'nav.deploy': 'デプロイ',
            'nav.chat': 'チャット',
            'nav.config': '設定',
            'nav.storage': 'ストレージ',
            'nav.account': 'アカウント',
            'options.title': 'AgentAura 設定',
            'options.subtitle': 'ブラウザ自動化エージェントを設定',
            'options.langLabel': 'インターフェース言語',
            'options.langDesc': '拡張機能の表示言語を選択',
            'options.save': '設定を保存',
            'options.saved': '設定を保存しました',
            'deploy.button': 'OpenClaw をデプロイ',
            'claws.deployNow': '今すぐデプロイ',
            'storage.addRemote': 'ストレージを追加',
            'chat.newSession': '新しいセッション',
            'header.refresh': '更新'
        },
        ko: {
            'auth.signIn': '로그인',
            'auth.signUp': '계정 만들기',
            'auth.guest': '게스트로 계속',
            'nav.claws': '인스턴스',
            'nav.deploy': '배포',
            'nav.chat': '채팅',
            'nav.config': '설정',
            'nav.storage': '스토리지',
            'nav.account': '계정',
            'options.title': 'AgentAura 설정',
            'options.subtitle': '브라우저 자동화 에이전트를 구성합니다',
            'options.langLabel': '인터페이스 언어',
            'options.langDesc': '확장 프로그램 표시 언어를 선택하세요',
            'options.save': '설정 저장',
            'options.saved': '설정이 저장되었습니다!',
            'deploy.button': 'OpenClaw 배포',
            'claws.deployNow': '지금 배포',
            'storage.addRemote': '스토리지 추가',
            'chat.newSession': '새 세션',
            'header.refresh': '새로고침'
        },
        pl: {
            'auth.signIn': 'Zaloguj się',
            'auth.signUp': 'Utwórz konto',
            'auth.guest': 'Kontynuuj jako gość',
            'nav.claws': 'Instancje',
            'nav.deploy': 'Wdrożenie',
            'nav.chat': 'Czat',
            'nav.config': 'Konfiguracja',
            'nav.storage': 'Pamięć',
            'nav.account': 'Konto',
            'options.title': 'Ustawienia AgentAura',
            'options.subtitle': 'Skonfiguruj agenta automatyzacji przeglądarki',
            'options.langLabel': 'Język interfejsu',
            'options.langDesc': 'Wybierz język wyświetlania rozszerzenia',
            'options.save': 'Zapisz ustawienia',
            'options.saved': 'Ustawienia zapisane!',
            'deploy.button': 'Wdróż OpenClaw',
            'claws.deployNow': 'Wdróż teraz',
            'storage.addRemote': 'Dodaj magazyn',
            'chat.newSession': 'Nowa sesja',
            'header.refresh': 'Odśwież'
        },
        'pt-BR': {
            'auth.signIn': 'Entrar',
            'auth.signUp': 'Criar conta',
            'auth.guest': 'Continuar como convidado',
            'nav.claws': 'Instâncias',
            'nav.deploy': 'Implantar',
            'nav.chat': 'Chat',
            'nav.config': 'Configuração',
            'nav.storage': 'Armazenamento',
            'nav.account': 'Conta',
            'options.title': 'Configurações do AgentAura',
            'options.subtitle': 'Configure seu agente de automação do navegador',
            'options.langLabel': 'Idioma da interface',
            'options.langDesc': 'Escolha o idioma exibido pela extensão',
            'options.save': 'Salvar configurações',
            'options.saved': 'Configurações salvas!',
            'deploy.button': 'Implantar OpenClaw',
            'claws.deployNow': 'Implantar agora',
            'storage.addRemote': 'Adicionar armazenamento',
            'chat.newSession': 'Nova sessão',
            'header.refresh': 'Atualizar'
        },
        ru: {
            'auth.signIn': 'Войти',
            'auth.signUp': 'Создать аккаунт',
            'auth.guest': 'Продолжить как гость',
            'nav.claws': 'Инстансы',
            'nav.deploy': 'Развернуть',
            'nav.chat': 'Чат',
            'nav.config': 'Настройки',
            'nav.storage': 'Хранилище',
            'nav.account': 'Аккаунт',
            'options.title': 'Настройки AgentAura',
            'options.subtitle': 'Настройте агента автоматизации браузера',
            'options.langLabel': 'Язык интерфейса',
            'options.langDesc': 'Выберите язык отображения расширения',
            'options.save': 'Сохранить настройки',
            'options.saved': 'Настройки сохранены!',
            'deploy.button': 'Развернуть OpenClaw',
            'claws.deployNow': 'Развернуть сейчас',
            'storage.addRemote': 'Добавить хранилище',
            'chat.newSession': 'Новая сессия',
            'header.refresh': 'Обновить'
        },
        tr: {
            'auth.signIn': 'Giriş yap',
            'auth.signUp': 'Hesap oluştur',
            'auth.guest': 'Misafir olarak devam et',
            'nav.claws': 'Örnekler',
            'nav.deploy': 'Dağıt',
            'nav.chat': 'Sohbet',
            'nav.config': 'Yapılandırma',
            'nav.storage': 'Depolama',
            'nav.account': 'Hesap',
            'options.title': 'AgentAura Ayarları',
            'options.subtitle': 'Tarayıcı otomasyon aracınızı yapılandırın',
            'options.langLabel': 'Arayüz dili',
            'options.langDesc': 'Uzantının görüntüleme dilini seçin',
            'options.save': 'Ayarları kaydet',
            'options.saved': 'Ayarlar kaydedildi!',
            'deploy.button': 'OpenClaw dağıt',
            'claws.deployNow': 'Şimdi dağıt',
            'storage.addRemote': 'Depolama ekle',
            'chat.newSession': 'Yeni oturum',
            'header.refresh': 'Yenile'
        }
    }

    Object.entries(localizedOverrides).forEach(([lang, overrides]) => {
        translations[lang] = { ...translations[lang], ...overrides }
    })

    const languageLabels = {
        ar: 'عربي',
        de: 'Deutsch',
        en: 'English',
        es: 'Español (Spain)',
        'es-419': 'Español (LA)',
        fr: 'Français',
        it: 'Italiano',
        ja: '日本語',
        ko: '한국어',
        pl: 'Polski',
        'pt-BR': 'Português (Brasil)',
        ru: 'Русский',
        tr: 'Türkçe',
        zh: '简体中文'
    }

    let currentLang = 'en'

    function normalizeLanguage(lang) {
        if (!lang) return 'en'

        const lowerLang = String(lang).trim().toLowerCase()

        if (lowerLang.startsWith('zh')) return 'zh'
        if (lowerLang.startsWith('ar')) return 'ar'
        if (lowerLang.startsWith('de')) return 'de'
        if (lowerLang === 'es-419' || lowerLang.startsWith('es-419') || lowerLang.startsWith('es-mx') || lowerLang.startsWith('es-ar') || lowerLang.startsWith('es-cl') || lowerLang.startsWith('es-co') || lowerLang.startsWith('es-pe') || lowerLang.startsWith('es-ve')) return 'es-419'
        if (lowerLang.startsWith('es')) return 'es'
        if (lowerLang.startsWith('fr')) return 'fr'
        if (lowerLang.startsWith('it')) return 'it'
        if (lowerLang.startsWith('ja')) return 'ja'
        if (lowerLang.startsWith('ko')) return 'ko'
        if (lowerLang.startsWith('pl')) return 'pl'
        if (lowerLang.startsWith('pt')) return 'pt-BR'
        if (lowerLang.startsWith('ru')) return 'ru'
        if (lowerLang.startsWith('tr')) return 'tr'
        if (lowerLang.startsWith('en')) return 'en'

        return translations[lang] ? lang : 'en'
    }

    function detectLanguage() {
        try {
            const uiLang = chrome.i18n?.getUILanguage?.()
            if (uiLang) {
                return normalizeLanguage(uiLang)
            }
        } catch (_) { }
        const nav = navigator.language || navigator.languages?.[0] || 'en'
        return normalizeLanguage(nav)
    }

    async function init() {
        // English unless the user has chosen otherwise. This used to follow the browser's UI
        // language, which meant the same build opened in a different language depending on
        // whose machine it was — surprising for a product whose own copy, docs and store
        // listing are in English. detectLanguage() is still exported for anyone who wants to
        // offer "match my browser" explicitly.
        try {
            const result = await chrome.storage?.local?.get?.(['i18n_lang'])
            currentLang = result && result.i18n_lang
                ? normalizeLanguage(result.i18n_lang)
                : 'en'
        } catch (_) {
            currentLang = 'en'
        }
        return currentLang
    }

    function t(key, params) {
        let str = translations[currentLang]?.[key] || translations.en[key] || key
        if (params) {
            Object.keys(params).forEach((k) => {
                str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k])
            })
        }
        return str
    }

    function setLang(lang) {
        const normalizedLang = normalizeLanguage(lang)
        if (translations[normalizedLang]) {
            currentLang = normalizedLang
            chrome.storage?.local?.set?.({ i18n_lang: normalizedLang })
        }
    }

    function getLang() {
        return currentLang
    }

    function getAvailableLanguages() {
        return [
            { code: 'ar', label: languageLabels.ar },
            { code: 'de', label: languageLabels.de },
            { code: 'en', label: languageLabels.en },
            { code: 'es', label: languageLabels.es },
            { code: 'es-419', label: languageLabels['es-419'] },
            { code: 'fr', label: languageLabels.fr },
            { code: 'it', label: languageLabels.it },
            { code: 'ja', label: languageLabels.ja },
            { code: 'ko', label: languageLabels.ko },
            { code: 'pl', label: languageLabels.pl },
            { code: 'pt-BR', label: languageLabels['pt-BR'] },
            { code: 'ru', label: languageLabels.ru },
            { code: 'tr', label: languageLabels.tr },
            { code: 'zh', label: languageLabels.zh }
        ]
    }

    function applyToPage() {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n')
            el.textContent = t(key)
        })
        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = el.getAttribute('data-i18n-placeholder')
            el.placeholder = t(key)
        })
        document.querySelectorAll('[data-i18n-title]').forEach((el) => {
            const key = el.getAttribute('data-i18n-title')
            el.title = t(key)
        })
        document.querySelectorAll('[data-i18n-prompt]').forEach((el) => {
            const key = el.getAttribute('data-i18n-prompt')
            el.setAttribute('data-prompt', t(key))
        })
    }

    return { init, t, setLang, getLang, getAvailableLanguages, applyToPage, detectLanguage }
})()

if (typeof module !== 'undefined' && module.exports) {
    module.exports = I18n
}